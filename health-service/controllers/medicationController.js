const { Medication, MedicationLog, Patient } = require("../models");
const { sequelize } = require("../models"); // For transaction
const { Op } = require("sequelize"); // For date comparison
const axios = require("axios");
const Redis = require("ioredis");
const redis = new Redis(process.env.REDIS_URL);

// Add medication
const addMedication = async (req, res) => {
  try {
    const { patientId, name, dosage, schedule, frequency } = req.body;

    const medication = await Medication.create({
      patient_id: patientId,
      name,
      dosage,
      schedule,
      frequency,
    });

    // Invalidate patient cache
    await redis.del(`patient:${patientId}:medications`);

    res.status(201).json({
      success: true,
      medication,
    });
  } catch (error) {
    console.error("Add medication error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to add medication",
    });
  }
};

// Get patient medications
const getPatientMedications = async (req, res) => {
  try {
    const { patientId } = req.params;

    // Try cache first
    const cached = await redis.get(`patient:${patientId}:medications`);
    if (cached) {
      return res.json({
        success: true,
        medications: JSON.parse(cached),
        source: "cache",
      });
    }

    const medications = await Medication.findAll({
      where: { patient_id: patientId, status: "active" },
      order: [["schedule", "ASC"]],
    });

    // Cache for 5 minutes
    await redis.setex(
      `patient:${patientId}:medications`,
      300,
      JSON.stringify(medications),
    );

    res.json({
      success: true,
      medications,
      source: "database",
    });
  } catch (error) {
    console.error("Get medications error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to get medications",
    });
  }
};

// MARK AS TAKEN - Core feature with concurrency control
const markAsTaken = async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  // Start a database transaction
  const transaction = await sequelize.transaction();

  try {
    // 1. Find medication with ROW LOCK (FOR UPDATE)
    const medication = await Medication.findByPk(id, {
      lock: transaction.LOCK.UPDATE,
      transaction,
      include: [{ model: Patient }],
    });

    if (!medication) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        error: "Medication not found",
      });
    }

    // 2. Check if already taken today
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const existingLog = await MedicationLog.findOne({
      where: {
        medication_id: id,
        taken_at: { [Op.gte]: today },
      },
      transaction,
    });

    // 3. If already taken, rollback and return conflict
    if (existingLog) {
      await transaction.rollback();
      return res.status(409).json({
        success: false,
        error: "Medication already taken today",
        takenAt: existingLog.taken_at,
        takenBy: existingLog.marked_by,
      });
    }

    // 4. Create log entry
    const log = await MedicationLog.create(
      {
        medication_id: id,
        patient_id: medication.patient_id,
        marked_by: userId,
        taken_at: new Date(),
        status: "taken",
      },
      { transaction },
    );

    // 5. Increment version (optimistic locking)
    medication.version = (medication.version || 0) + 1;
    await medication.save({ transaction });

    // 6. Commit transaction - releases the lock
    await transaction.commit();

    // 7. Invalidate cache
    await redis.del(`patient:${medication.patient_id}:medications`);

    // 8. Publish to Redis for real-time updates
    const eventData = {
      type: "TAKEN",
      medicationId: medication.id,
      medicationName: medication.name,
      patientId: medication.patient_id,
      patientName: medication.Patient.name,
      familyId: medication.Patient.family_id,
      takenBy: req.user.name || "Family Member",
      time: new Date().toISOString(),
      logId: log.id,
      version: medication.version,
    };

    await redis.publish("medication:taken", JSON.stringify(eventData));
    console.log("📢 Published medication:taken event:", eventData);

    res.json({
      success: true,
      message: "Medication marked as taken",
      log,
      version: medication.version,
      realtime: "Update sent to family members",
    });
  } catch (error) {
    // Rollback transaction on error
    await transaction.rollback();
    console.error("Mark as taken error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to mark medication as taken",
    });
  }
};

// Get drug info from external API
const getDrugInfo = async (req, res) => {
  try {
    const { name } = req.params;

    // Check Redis cache first
    const cached = await redis.get(`drug:${name}`);
    if (cached) {
      return res.json({
        success: true,
        drug: JSON.parse(cached),
        source: "cache",
      });
    }

    // Call OpenFDA API
    const response = await axios.get(
      `https://api.fda.gov/drug/label.json?search=openfda.brand_name:"${name}"&limit=1`,
    );

    if (!response.data.results || response.data.results.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Drug not found",
      });
    }

    const drugData = response.data.results[0];
    const drugInfo = {
      name: name,
      purpose: drugData.purpose || ["Information not available"],
      warnings: drugData.warnings || ["No warnings available"],
      dosage: drugData.dosage_and_administration || ["Follow prescription"],
      sideEffects: drugData.adverse_reactions || ["Consult doctor"],
    };

    // Cache for 24 hours
    await redis.setex(`drug:${name}`, 86400, JSON.stringify(drugInfo));

    res.json({
      success: true,
      drug: drugInfo,
      source: "api",
    });
  } catch (error) {
    console.error("Drug info error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch drug information",
    });
  }
};

// Get medication history
const getMedicationHistory = async (req, res) => {
  try {
    const { patientId } = req.params;
    const { days = 7 } = req.query;

    const date = new Date();
    date.setDate(date.getDate() - days);

    const logs = await MedicationLog.findAll({
      where: {
        patient_id: patientId,
        taken_at: { [Op.gte]: date },
      },
      include: [{ model: Medication }],
      order: [["taken_at", "DESC"]],
    });

    res.json({
      success: true,
      history: logs,
    });
  } catch (error) {
    console.error("History error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to get medication history",
    });
  }
};

// Get missed medications for a patient
const getMissedMedications = async (req, res) => {
  try {
    const { patientId } = req.params;
    const { days = 7 } = req.query;

    const date = new Date();
    date.setDate(date.getDate() - days);

    const missedLogs = await MedicationLog.findAll({
      where: {
        patient_id: patientId,
        status: "missed",
        taken_at: { [Op.gte]: date },
      },
      include: [
        { model: Medication, attributes: ["name", "dosage", "schedule"] },
      ],
      order: [["taken_at", "DESC"]],
    });

    res.json({
      success: true,
      missedMedications: missedLogs.map((log) => ({
        id: log.id,
        medicationName: log.Medication.name,
        dosage: log.Medication.dosage,
        scheduledTime: log.Medication.schedule,
        missedAt: log.taken_at,
        notes: log.notes,
      })),
    });
  } catch (error) {
    console.error("Get missed medications error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to get missed medications",
    });
  }
};

module.exports = {
  addMedication,
  getPatientMedications,
  markAsTaken,
  getDrugInfo,
  getMedicationHistory,
  getMissedMedications,
};
