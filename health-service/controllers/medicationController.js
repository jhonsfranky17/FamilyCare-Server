const { Medication, MedicationLog, Patient } = require("../models");
const axios = require("axios");
const Redis = require("ioredis");
const redis = new Redis(process.env.REDIS_URL);

// Add medication (/patients/:patientId/medications)
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

// Get patient medications (/patients/:patientId/medications)
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

// MARK AS TAKEN - Core feature! (/medications/:id/taken)
const markAsTaken = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Find medication
    const medication = await Medication.findByPk(id, {
      include: [{ model: Patient }],
    });

    if (!medication) {
      return res.status(404).json({
        success: false,
        error: "Medication not found",
      });
    }

    // Create log
    const log = await MedicationLog.create({
      medication_id: id,
      patient_id: medication.patient_id,
      marked_by: userId,
      taken_at: new Date(),
      status: "taken",
    });

    // Invalidate cache
    await redis.del(`patient:${medication.patient_id}:medications`);

    // Publish to Redis for real-time updates
    await redis.publish(
      "medication:updates",
      JSON.stringify({
        type: "taken",
        patientId: medication.patient_id,
        patientName: medication.Patient.name,
        medicationName: medication.name,
        takenBy: req.user.name,
        time: new Date().toISOString(),
      }),
    );

    res.json({
      success: true,
      message: "Medication marked as taken",
      log,
    });
  } catch (error) {
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

// Get medication history (/patients/:patientId/medications/history?days=7)
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

module.exports = {
  addMedication,
  getPatientMedications,
  markAsTaken,
  getDrugInfo,
  getMedicationHistory,
};
