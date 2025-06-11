const mongoose = require("mongoose");

const participantSchema = new mongoose.Schema({
  id: String,
  type: {
    type: String,
    enum: ["adult", "minor"],
  },
  firstName: String,
  lastName: String,
  fullName: String,
  dateOfBirth: Date,
  signature: String,
  age: Number,
  isSigningAdult: {
    type: Boolean,
    default: false,
  },
  minorsSignedFor: [
    {
      id: String,
      name: String,
    },
  ],
  signingAdultId: String,
  signingAdultName: String,
});

// Define the nested schemas properly
const allParticipantSchema = new mongoose.Schema(
  {
    id: String,
    name: String,
    type: String,
    age: Number,
  },
  { _id: false }
); // Disable _id for subdocuments

const searchIndexesSchema = new mongoose.Schema(
  {
    names: [String],
    firstNames: [String],
    lastNames: [String],
    allParticipants: [allParticipantSchema], // Use the defined schema
  },
  { _id: false }
);

const waiverSummarySchema = new mongoose.Schema(
  {
    id: String,
    dateSubmitted: String,
    participantNames: String,
    participantCount: Number,
    hasMinors: Boolean,
    signingAdults: [String],
  },
  { _id: false }
);

const waiverSchema = new mongoose.Schema(
  {
    waiverId: {
      type: String,
      required: true,
      unique: true,
    },
    submissionDate: {
      type: Date,
      required: true,
    },
    participationType: String,
    totalParticipants: Number,
    adultCount: Number,
    minorCount: Number,
    participants: [participantSchema],
    searchIndexes: searchIndexesSchema, // Use the defined schema
    waiverSummary: waiverSummarySchema, // Use the defined schema
  },
  {
    timestamps: true,
  }
);

const Waiver = mongoose.model("Waiver", waiverSchema);
module.exports = Waiver;
