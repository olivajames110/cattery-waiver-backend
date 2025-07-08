const express = require("express");
const router = express.Router();
const Waiver = require("../models/Waiver");

// Helper functions
const generateWaiverId = () => {
  return `W${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

const calculateAge = (dateOfBirth) => {
  if (!dateOfBirth) return null;
  const today = new Date();
  const birthDate = new Date(dateOfBirth);
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (
    monthDiff < 0 ||
    (monthDiff === 0 && today.getDate() < birthDate.getDate())
  ) {
    age--;
  }
  return age;
};

const transformFormDataForBackend = (formData) => {
  const waiverId = generateWaiverId();
  const submissionDate = new Date().toISOString();

  const participants = [];

  // Process adults
  for (let i = 0; i < parseInt(formData.adultCount || 0); i++) {
    const adult = formData[`adult_${i}`];
    if (adult && adult.firstName && adult.lastName) {
      participants.push({
        id: `${waiverId}_adult_${i}`,
        type: "adult",
        firstName: adult.firstName,
        lastName: adult.lastName,
        fullName: `${adult.lastName}, ${adult.firstName}`,
        dateOfBirth: adult.dateOfBirth,
        signature: adult.signature,
        age: calculateAge(adult.dateOfBirth),
        isSigningAdult: false,
        minorsSignedFor: [],
      });
    }
  }

  // Process minors and update signing adults
  for (let i = 0; i < parseInt(formData.minorCount || 0); i++) {
    const minor = formData[`minor_${i}`];
    if (minor && minor.firstName && minor.lastName) {
      const signingAdultId = minor.signingAdult;

      const minorParticipant = {
        id: `${waiverId}_minor_${i}`,
        type: "minor",
        firstName: minor.firstName,
        lastName: minor.lastName,
        fullName: `${minor.lastName}, ${minor.firstName}`,
        dateOfBirth: minor.dateOfBirth,
        age: calculateAge(minor.dateOfBirth),
        signingAdultId: signingAdultId,
        signingAdultName: "",
      };

      // Find and update the signing adult
      const signingAdultIndex = participants.findIndex((p) =>
        p.id.includes(signingAdultId)
      );
      if (signingAdultIndex !== -1) {
        participants[signingAdultIndex].isSigningAdult = true;
        participants[signingAdultIndex].minorsSignedFor.push({
          id: minorParticipant.id,
          name: `${minor.firstName} ${minor.lastName}`,
        });
        minorParticipant.signingAdultName =
          participants[signingAdultIndex].fullName;
      }

      participants.push(minorParticipant);
    }
  }

  // Create searchable indexes
  const searchIndexes = {
    names: participants.map((p) => p.fullName.toLowerCase()),
    firstNames: participants.map((p) => p.firstName.toLowerCase()),
    lastNames: participants.map((p) => p.lastName.toLowerCase()),
    allParticipants: participants.map((p) => ({
      id: p.id,
      name: p.fullName,
      type: p.type,
      age: p.age,
    })),
  };

  return {
    waiverId,
    submissionDate,
    participationType: formData.participationType,
    totalParticipants: participants.length,
    adultCount: participants.filter((p) => p.type === "adult").length,
    minorCount: participants.filter((p) => p.type === "minor").length,
    participants,
    searchIndexes,
    waiverSummary: {
      id: waiverId,
      dateSubmitted: submissionDate.split("T")[0],
      participantNames: participants.map((p) => p.fullName).join(", "),
      participantCount: participants.length,
      hasMinors: participants.some((p) => p.type === "minor"),
      signingAdults: participants
        .filter((p) => p.isSigningAdult)
        .map((p) => p.fullName),
    },
  };
};

// POST endpoint to submit waiver
router.post("/submit", async (req, res) => {
  try {
    console.log("Raw request body:", JSON.stringify(req.body, null, 2));

    // Use the data directly since it's already transformed
    const waiver = new Waiver(req.body);

    console.log(
      "Waiver before save:",
      JSON.stringify(waiver.toObject(), null, 2)
    );

    const savedWaiver = await waiver.save();

    console.log(
      "Saved waiver:",
      JSON.stringify(savedWaiver.toObject(), null, 2)
    );

    res.status(201).json({
      success: true,
      message: "Waiver submitted successfully",
      waiverId: req.body.waiverId,
      data: req.body,
    });
  } catch (error) {
    console.error("Error submitting waiver:", error);
    res.status(500).json({
      success: false,
      message: "Error submitting waiver",
      error: error.message,
    });
  }
});

// GET endpoint to fetch all participants/users
router.get("/users/all", async (req, res) => {
  try {
    console.log("Fetching waivers...");
    const waivers = await Waiver.find({}).sort({ submissionDate: -1 });
    console.log(`Found ${waivers.length} waivers`);

    // Log first waiver structure
    if (waivers.length > 0) {
      console.log(
        "Participants in first waiver:",
        waivers[0].participants.length
      );
    }

    const participantsMap = new Map();
    let totalParticipantsProcessed = 0;

    waivers.forEach((waiver, index) => {
      console.log(
        `Processing waiver ${index + 1}, participants: ${
          waiver.participants.length
        }`
      );

      waiver.participants.forEach((participant) => {
        totalParticipantsProcessed++;
        const uniqueKey = `${participant.fullName}-${participant.dateOfBirth}`;

        // If this person hasn't been added yet, or if this is a more recent waiver
        if (
          !participantsMap.has(uniqueKey) ||
          new Date(waiver.submissionDate) >
            new Date(participantsMap.get(uniqueKey).lastSigned)
        ) {
          const existingParticipant = participantsMap.get(uniqueKey);
          const existingWaiverIds = existingParticipant?.waiverIds || [];
          const existingTotalWaivers = existingParticipant?.totalWaivers || 0;

          participantsMap.set(uniqueKey, {
            id: participant.id,
            firstName: participant.firstName,
            lastName: participant.lastName,
            fullName: participant.fullName,
            dateOfBirth: participant.dateOfBirth,
            age: participant.age,
            type: participant.type,
            lastSigned: waiver.submissionDate,
            lastWaiverId: waiver.waiverId,
            totalWaivers: existingTotalWaivers + 1,
            waiverIds: [...existingWaiverIds, waiver.waiverId],
            // Additional fields for minors
            signingAdultId: participant.signingAdultId || null,
            signingAdultName: participant.signingAdultName || null,
            // Additional fields for signing adults
            isSigningAdult: participant.isSigningAdult || false,
            minorsSignedFor: participant.minorsSignedFor || [],
          });
        } else {
          // Update waiver count and IDs for existing participant
          const existing = participantsMap.get(uniqueKey);
          existing.totalWaivers += 1;
          if (!existing.waiverIds.includes(waiver.waiverId)) {
            existing.waiverIds.push(waiver.waiverId);
          }
        }
      });
    });

    console.log(`Total participants processed: ${totalParticipantsProcessed}`);

    // Convert map to array
    const allParticipants = Array.from(participantsMap.values());
    console.log(`Final participants count: ${allParticipants.length}`);

    // Sort by last signed date (most recent first)
    allParticipants.sort(
      (a, b) => new Date(b.lastSigned) - new Date(a.lastSigned)
    );

    res.json({
      success: true,
      data: allParticipants,
      total: allParticipants.length,
      summary: {
        totalParticipants: allParticipants.length,
        adults: allParticipants.filter((p) => p.type === "adult").length,
        minors: allParticipants.filter((p) => p.type === "minor").length,
        signingAdults: allParticipants.filter((p) => p.isSigningAdult).length,
      },
    });
  } catch (error) {
    console.error("Error fetching all users:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching all users",
      error: error.message,
    });
  }
});

router.get("/wake-up", async (req, res) => {
  try {
    console.log(
      "Server wake-up request received at:",
      new Date().toISOString()
    );

    // You can optionally do a simple database ping to fully wake up all services
    // const waiversCount = await Waiver.countDocuments();
    // console.log("Database connection verified, total waivers:", waiversCount);

    res.status(200).json({
      success: true,
      message: "Server is awake",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error in wake-up endpoint:", error);
    res.status(500).json({
      success: false,
      message: "Error waking up server",
      error: error.message,
    });
  }
});

// Alternative: If you want to include a database ping to ensure full wake-up
router.get("/wake-up-with-db", async (req, res) => {
  try {
    console.log(
      "Server wake-up request received at:",
      new Date().toISOString()
    );

    // Ping the database to ensure it's also awake
    const waiversCount = await Waiver.countDocuments();
    console.log("Database connection verified, total waivers:", waiversCount);

    res.status(200).json({
      success: true,
      message: "Server and database are awake",
      timestamp: new Date().toISOString(),
      waiversCount: waiversCount,
    });
  } catch (error) {
    console.error("Error in wake-up endpoint:", error);
    res.status(500).json({
      success: false,
      message: "Error waking up server",
      error: error.message,
    });
  }
});

// Add this endpoint to your routes/waivers.js file

module.exports = router;
