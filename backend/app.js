// app.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Endpoint to fetch environment variables
app.get('/config', (req, res) => {
  res.json({
    CLIENT_ID: process.env.CLIENT_ID,
    API_KEY: process.env.API_KEY,
    SHEET_ID: process.env.SHEET_ID,
    SCOPES: process.env.SCOPES,
    EVALUATOR_PASSWORDS: JSON.parse(process.env.EVALUATOR_PASSWORDS),
    SHEET_RANGES: JSON.parse(process.env.SHEET_RANGES),
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

