// server.js
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bodyParser = require("body-parser");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ extended: true, limit: "50mb" }));

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const db = mongoose.connection;
db.on("error", console.error.bind(console, "MongoDB connection error:"));
db.once("open", () => {
  console.log("Connected to MongoDB");
});

// Test route
app.get("/", (req, res) => {
  res.json({ message: "Cattery Waiver API is running!" });
});

// Import routes (we'll create this next)
const waiverRoutes = require("./routes/waivers");
app.use("/api/waivers", waiverRoutes);

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
