const { Queue, Worker } = require("bullmq");
const Redis = require("ioredis");
const { Medication, Patient, MedicationLog } = require("../models");
const { Op } = require("sequelize");

const connection = new Redis({ host: "localhost", port: 6379 });

// Queue for checking missed medications
const missedQueue = new Queue("missed-medications", { connection });

// Worker that runs daily to find missed medications
const missedWorker = new Worker(
  "missed-medications",
  async (job) => {
    const { medicationId, scheduledTime, patientId, familyId } = job.data;

    console.log(
      `Checking missed medication ${medicationId} scheduled at ${scheduledTime}`,
    );

    // Get today's date range
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    // Check if already taken today
    const takenLog = await MedicationLog.findOne({
      where: {
        medication_id: medicationId,
        taken_at: { [Op.between]: [todayStart, todayEnd] },
        status: "taken",
      },
    });

    if (!takenLog) {
      // Not taken – create missed log
      const missedLog = await MedicationLog.create({
        medication_id: medicationId,
        patient_id: patientId,
        marked_by: null,
        taken_at: new Date(),
        status: "missed",
        notes: "Auto-detected missed medication",
      });

      console.log(
        `❌ Missed medication ${medicationId} for patient ${patientId}`,
      );

      // Publish missed event for real-time notification
      const redis = new Redis({ host: "localhost", port: 6379 });
      await redis.publish(
        "medication:missed",
        JSON.stringify({
          type: "MISSED",
          medicationId,
          patientId,
          scheduledTime,
          familyId,
          timestamp: new Date().toISOString(),
        }),
      );
    }

    return { checked: true, wasTaken: !!takenLog };
  },
  { connection },
);

// Schedule missed checks for a medication
const scheduleMissedCheck = async (
  medicationId,
  patientId,
  familyId,
  scheduleTime,
  graceMinutes = 120,
) => {
  // Parse schedule time (e.g., "08:00:00")
  const [hours, minutes] = scheduleTime.split(":");

  const now = new Date();
  const checkTime = new Date();
  checkTime.setHours(parseInt(hours), parseInt(minutes), 0, 0);

  // Add grace period
  checkTime.setMinutes(checkTime.getMinutes() + graceMinutes);

  // If check time has passed today, schedule for tomorrow
  if (checkTime < now) {
    checkTime.setDate(checkTime.getDate() + 1);
  }

  const delay = checkTime.getTime() - now.getTime();

  await missedQueue.add(
    `missed-${medicationId}`,
    { medicationId, patientId, familyId, scheduledTime: scheduleTime },
    {
      delay,
      jobId: `missed-${medicationId}-${checkTime.toISOString().split("T")[0]}`, // unique per day
      repeat: { pattern: `${minutes} ${parseInt(hours) + 2} * * *` }, // 2 hours after schedule
    },
  );

  console.log(
    `Scheduled missed check for medication ${medicationId} at ${checkTime.toLocaleTimeString()}`,
  );
};

// Initialize all missed checks on startup
const initializeMissedChecks = async () => {
  console.log("Initializing missed medication checks...");

  const medications = await Medication.findAll({
    where: { status: "active" },
    include: [{ model: Patient }],
  });

  for (const med of medications) {
    await scheduleMissedCheck(
      med.id,
      med.patient_id,
      med.Patient.family_id,
      med.schedule,
      120, // 2 hours grace period
    );
  }

  console.log(`Scheduled missed checks for ${medications.length} medications`);
};

module.exports = {
  missedQueue,
  scheduleMissedCheck,
  initializeMissedChecks,
};
