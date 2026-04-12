const axios = require("axios");

const GATEWAY = "http://localhost:3000";

async function testConcurrency() {
  console.log("Testing Concurrency Control...\n");

  // Login
  const loginRes = await axios.post(`${GATEWAY}/auth/login`, {
    email: "test@example.com",
    password: "password123",
  });

  const token = loginRes.data.token;
  console.log("Logged in");

  // First, list medications to get a valid medication ID
  try {
    const medsRes = await axios.get(
      `${GATEWAY}/health/patients/1/medications`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    console.log(
      "Available medications:",
      medsRes.data.medications.map((m) => ({ id: m.id, name: m.name })),
    );
  } catch (e) {
    console.log("Could not fetch medications, using ID 1 (may fail)");
  }

  const medicationId = 1; // Change to an ID that exists in your system

  console.log(
    `\nSending 5 concurrent requests to mark medication ${medicationId} as taken...\n`,
  );

  const requests = [];
  for (let i = 0; i < 5; i++) {
    requests.push(
      axios
        .post(
          `${GATEWAY}/health/medications/${medicationId}/taken`,
          {},
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        )
        .catch((err) => err.response),
    );
  }

  const results = await Promise.all(requests);

  let successCount = 0;
  let conflictCount = 0;

  results.forEach((res, index) => {
    if (res.data?.success) {
      successCount++;
      console.log(
        `Request ${index + 1}: SUCCESS (Version: ${res.data.version})`,
      );
    } else if (res.status === 409) {
      conflictCount++;
      console.log(`Request ${index + 1}: CONFLICT - Already taken today`);
    } else {
      console.log(
        `Request ${index + 1}: ${res.status} - ${res.data?.error || "Unknown error"}`,
      );
    }
  });

  console.log(
    `\nResults: ${successCount} succeeded, ${conflictCount} conflicts`,
  );
  console.log(
    successCount === 1
      ? "\nCONCURRENCY CONTROL WORKING! Only one request succeeded."
      : "\nConcurrency control needs adjustment",
  );
}

testConcurrency().catch(console.error);
