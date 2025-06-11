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
    const transformedData = transformFormDataForBackend(req.body);

    const waiver = new Waiver(transformedData);
    await waiver.save();

    res.status(201).json({
      success: true,
      message: "Waiver submitted successfully",
      waiverId: transformedData.waiverId,
      data: transformedData,
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

// GET endpoint to search waivers and participants
router.get("/search", async (req, res) => {
  try {
    const { query, startDate, endDate } = req.query;

    let searchQuery = {};

    // Build search query
    if (query) {
      const searchRegex = new RegExp(query, "i");
      searchQuery.$or = [
        { "participants.fullName": searchRegex },
        { "participants.firstName": searchRegex },
        { "participants.lastName": searchRegex },
        { "searchIndexes.names": searchRegex },
      ];
    }

    // Add date range filter if provided
    if (startDate || endDate) {
      searchQuery.submissionDate = {};
      if (startDate) searchQuery.submissionDate.$gte = new Date(startDate);
      if (endDate) searchQuery.submissionDate.$lte = new Date(endDate);
    }

    const waivers = await Waiver.find(searchQuery).sort({ submissionDate: -1 });

    // Transform data for AG Grid
    const gridData = [];
    waivers.forEach((waiver) => {
      waiver.participants.forEach((participant) => {
        gridData.push({
          id: participant.id,
          waiverId: waiver.waiverId,
          name: participant.fullName,
          dateOfBirth: participant.dateOfBirth,
          dateSigned: waiver.submissionDate,
          signingAdult:
            participant.type === "minor" ? participant.signingAdultName : "",
          participantType: participant.type,
          age: participant.age,
        });
      });
    });

    res.json({
      success: true,
      data: gridData,
      total: gridData.length,
    });
  } catch (error) {
    console.error("Error searching waivers:", error);
    res.status(500).json({
      success: false,
      message: "Error searching waivers",
      error: error.message,
    });
  }
});

// GET endpoint to get a specific waiver by ID
router.get("/:waiverId", async (req, res) => {
  try {
    const { waiverId } = req.params;

    const waiver = await Waiver.findOne({ waiverId });

    if (!waiver) {
      return res.status(404).json({
        success: false,
        message: "Waiver not found",
      });
    }

    res.json({
      success: true,
      data: waiver,
    });
  } catch (error) {
    console.error("Error fetching waiver:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching waiver",
      error: error.message,
    });
  }
});

// GET endpoint to get waiver summary for a participant
router.get("/participant/:participantId", async (req, res) => {
  try {
    const { participantId } = req.params;

    const waiver = await Waiver.findOne({ "participants.id": participantId });

    if (!waiver) {
      return res.status(404).json({
        success: false,
        message: "Participant not found",
      });
    }

    const participant = waiver.participants.find((p) => p.id === participantId);

    res.json({
      success: true,
      data: {
        waiver: waiver.waiverSummary,
        participant: participant,
        allParticipants: waiver.participants,
      },
    });
  } catch (error) {
    console.error("Error fetching participant data:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching participant data",
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
        "First waiver structure:",
        JSON.stringify(waivers[0], null, 2)
      );
      console.log("Participants in first waiver:", waivers[0].participants);
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
        // ... rest of your logic
      });
    });

    console.log(`Total participants processed: ${totalParticipantsProcessed}`);

    const allParticipants = Array.from(participantsMap.values());
    console.log(`Final participants count: ${allParticipants.length}`);

    res.json({
      success: true,
      data: allParticipants,
      total: allParticipants.length,
      // ... rest of response
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

// Add this endpoint to your routes/waivers.js file

// // GET endpoint to fetch all participants/users
// router.get("/users/all", async (req, res) => {
//   try {
//     // Fetch all waivers
//     const waivers = await Waiver.find({}).sort({ submissionDate: -1 });

//     // Create a map to store unique participants
//     const participantsMap = new Map();

//     // Process all waivers to extract unique participants
//     waivers.forEach((waiver) => {
//       waiver.participants.forEach((participant) => {
//         // Create a unique key based on name and DOB to avoid duplicates
//         const uniqueKey = `${participant.fullName}-${participant.dateOfBirth}`;

//         // If this person hasn't been added yet, or if this is a more recent waiver
//         if (
//           !participantsMap.has(uniqueKey) ||
//           new Date(waiver.submissionDate) >
//             new Date(participantsMap.get(uniqueKey).lastSigned)
//         ) {
//           participantsMap.set(uniqueKey, {
//             id: participant.id,
//             firstName: participant.firstName,
//             lastName: participant.lastName,
//             fullName: participant.fullName,
//             dateOfBirth: participant.dateOfBirth,
//             age: participant.age,
//             type: participant.type,
//             lastSigned: waiver.submissionDate,
//             lastWaiverId: waiver.waiverId,
//             totalWaivers:
//               (participantsMap.get(uniqueKey)?.totalWaivers || 0) + 1,
//             waiverIds: [
//               ...(participantsMap.get(uniqueKey)?.waiverIds || []),
//               waiver.waiverId,
//             ],
//           });
//         }
//       });
//     });

//     // Convert map to array
//     const allParticipants = Array.from(participantsMap.values());

//     res.json({
//       success: true,
//       data: allParticipants,
//       total: allParticipants.length,
//       summary: {
//         totalParticipants: allParticipants.length,
//         adults: allParticipants.filter((p) => p.type === "adult").length,
//         minors: allParticipants.filter((p) => p.type === "minor").length,
//       },
//     });
//   } catch (error) {
//     console.error("Error fetching all users:", error);
//     res.status(500).json({
//       success: false,
//       message: "Error fetching all users",
//       error: error.message,
//     });
//   }
// });

// Modified users/all endpoint with debugging
router.get("/users/all", async (req, res) => {
  try {
    console.log("Fetching all waivers...");

    // First, let's see what's in the database
    const count = await Waiver.countDocuments();
    console.log("Document count:", count);

    // Fetch all waivers
    const waivers = await Waiver.find({}).sort({ submissionDate: -1 });
    console.log("Found waivers:", waivers.length);
    console.log("First waiver sample:", JSON.stringify(waivers[0], null, 2));

    // Create a map to store unique participants
    const participantsMap = new Map();

    // Process all waivers to extract unique participants
    waivers.forEach((waiver, waiverIndex) => {
      console.log(`Processing waiver ${waiverIndex + 1}:`, waiver.waiverId);

      if (!waiver.participants || !Array.isArray(waiver.participants)) {
        console.log("No participants array found in waiver:", waiver._id);
        return;
      }

      waiver.participants.forEach((participant, participantIndex) => {
        console.log(
          `  - Participant ${participantIndex + 1}:`,
          participant.fullName
        );

        // Create a unique key based on name and DOB to avoid duplicates
        const uniqueKey = `${participant.fullName}-${participant.dateOfBirth}`;

        // If this person hasn't been added yet, or if this is a more recent waiver
        if (
          !participantsMap.has(uniqueKey) ||
          new Date(waiver.submissionDate) >
            new Date(participantsMap.get(uniqueKey).lastSigned)
        ) {
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
            totalWaivers:
              (participantsMap.get(uniqueKey)?.totalWaivers || 0) + 1,
            waiverIds: [
              ...(participantsMap.get(uniqueKey)?.waiverIds || []),
              waiver.waiverId,
            ],
          });
        }
      });
    });

    // Convert map to array
    const allParticipants = Array.from(participantsMap.values());
    console.log("Total unique participants found:", allParticipants.length);

    res.json({
      success: true,
      data: allParticipants,
      total: allParticipants.length,
      summary: {
        totalParticipants: allParticipants.length,
        adults: allParticipants.filter((p) => p.type === "adult").length,
        minors: allParticipants.filter((p) => p.type === "minor").length,
      },
      debug: {
        totalWaivers: waivers.length,
        firstWaiver: waivers[0] || null,
      },
    });
  } catch (error) {
    console.error("Error fetching all users:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching all users",
      error: error.message,
      stack: error.stack,
    });
  }
});

// GET endpoint with pagination for all participants
router.get("/users", async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      sortBy = "lastSigned",
      sortOrder = "desc",
      type = "all", // 'all', 'adult', 'minor'
    } = req.query;

    const skip = (page - 1) * limit;

    // Build query
    let matchQuery = {};
    if (type !== "all") {
      matchQuery = { "participants.type": type };
    }

    // Aggregation pipeline to get unique participants
    const pipeline = [
      { $match: matchQuery },
      { $unwind: "$participants" },
      {
        $group: {
          _id: {
            fullName: "$participants.fullName",
            dateOfBirth: "$participants.dateOfBirth",
          },
          participant: { $first: "$participants" },
          lastSigned: { $max: "$submissionDate" },
          lastWaiverId: { $last: "$waiverId" },
          waiverCount: { $sum: 1 },
          waiverIds: { $push: "$waiverId" },
        },
      },
      {
        $project: {
          _id: 0,
          id: "$participant.id",
          firstName: "$participant.firstName",
          lastName: "$participant.lastName",
          fullName: "$participant.fullName",
          dateOfBirth: "$participant.dateOfBirth",
          age: "$participant.age",
          type: "$participant.type",
          lastSigned: 1,
          lastWaiverId: 1,
          waiverCount: 1,
          waiverIds: 1,
        },
      },
      { $sort: { [sortBy]: sortOrder === "desc" ? -1 : 1 } },
      { $skip: skip },
      { $limit: parseInt(limit) },
    ];

    // Execute aggregation
    const participants = await Waiver.aggregate(pipeline);

    // Get total count
    const totalPipeline = [
      { $match: matchQuery },
      { $unwind: "$participants" },
      {
        $group: {
          _id: {
            fullName: "$participants.fullName",
            dateOfBirth: "$participants.dateOfBirth",
          },
        },
      },
      { $count: "total" },
    ];

    const totalResult = await Waiver.aggregate(totalPipeline);
    const total = totalResult[0]?.total || 0;

    res.json({
      success: true,
      data: participants,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching users",
      error: error.message,
    });
  }
});

// GET endpoint to search for specific users
router.get("/users/search", async (req, res) => {
  try {
    const { query } = req.query;

    if (!query) {
      return res.status(400).json({
        success: false,
        message: "Search query is required",
      });
    }

    const searchRegex = new RegExp(query, "i");

    // Find all waivers containing matching participants
    const waivers = await Waiver.find({
      $or: [
        { "participants.fullName": searchRegex },
        { "participants.firstName": searchRegex },
        { "participants.lastName": searchRegex },
      ],
    });

    // Extract and deduplicate participants
    const participantsMap = new Map();

    waivers.forEach((waiver) => {
      waiver.participants.forEach((participant) => {
        // Check if participant matches the search
        if (
          searchRegex.test(participant.fullName) ||
          searchRegex.test(participant.firstName) ||
          searchRegex.test(participant.lastName)
        ) {
          const uniqueKey = `${participant.fullName}-${participant.dateOfBirth}`;

          if (
            !participantsMap.has(uniqueKey) ||
            new Date(waiver.submissionDate) >
              new Date(participantsMap.get(uniqueKey).lastSigned)
          ) {
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
              matchedOn: query,
            });
          }
        }
      });
    });

    const matchedParticipants = Array.from(participantsMap.values());

    res.json({
      success: true,
      data: matchedParticipants,
      total: matchedParticipants.length,
      query,
    });
  } catch (error) {
    console.error("Error searching users:", error);
    res.status(500).json({
      success: false,
      message: "Error searching users",
      error: error.message,
    });
  }
});

// Add this test endpoint to your routes/waivers.js file temporarily for debugging

// GET endpoint to test database connection and see raw data
router.get("/test-db", async (req, res) => {
  try {
    // Count documents
    const count = await Waiver.countDocuments();
    console.log("Total documents in waivers collection:", count);

    // Get all documents
    const allWaivers = await Waiver.find({});
    console.log("Raw waivers data:", JSON.stringify(allWaivers, null, 2));

    // Check if documents exist but maybe with different structure
    const rawDocuments = await Waiver.collection.find({}).toArray();
    console.log(
      "Raw documents from collection:",
      JSON.stringify(rawDocuments, null, 2)
    );

    res.json({
      success: true,
      count: count,
      waivers: allWaivers,
      rawDocuments: rawDocuments,
      message: "Check your server console for detailed logs",
    });
  } catch (error) {
    console.error("Database test error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack,
    });
  }
});

module.exports = router;
