const { medicationQueue } = require("./queues/medicationQueue");
const { Op } = require("sequelize");

async function showQueueStats() {
  console.log("\nBullMQ Queue Statistics\n");

  // Get accurate job counts
  const waitingCount = await medicationQueue.getWaitingCount();
  const activeCount = await medicationQueue.getActiveCount();
  const completedCount = await medicationQueue.getCompletedCount();
  const failedCount = await medicationQueue.getFailedCount();
  const delayedCount = await medicationQueue.getDelayedCount();

  console.log(`Waiting: ${waitingCount}`);
  console.log(`Active: ${activeCount}`);
  console.log(`Completed: ${completedCount}`);
  console.log(`Failed: ${failedCount}`);
  console.log(`Delayed: ${delayedCount}`);

  // Get delayed jobs (scheduled reminders)
  const delayedJobs = await medicationQueue.getDelayed();
  console.log(`\nNext ${Math.min(5, delayedJobs.length)} upcoming reminders:`);

  for (let i = 0; i < Math.min(5, delayedJobs.length); i++) {
    const job = delayedJobs[i];
    const delayMs = job.delay || 0;
    const delayMinutes = Math.floor(delayMs / 60000);
    const hours = Math.floor(delayMinutes / 60);
    const minutes = delayMinutes % 60;

    // Try to get medication name from job data
    const medicationId = job.data.medicationId;
    let medicationName = "Unknown";

    // Optionally fetch from database (commented out to avoid extra queries)
    // const med = await Medication.findByPk(medicationId);
    // if (med) medicationName = med.name;

    console.log(
      `   - Medication ID ${medicationId} will run in ${hours}h ${minutes}m`,
    );
  }

  console.log(
    `\nTip: Visit http://localhost:3003/admin/queues to see the visual dashboard`,
  );
}

showQueueStats().catch(console.error);
