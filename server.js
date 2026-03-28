const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

require('dotenv').config();

const app = express();

// Middleware
app.use(express.json());
app.use(cors());
app.use(helmet());
app.use(morgan('tiny'));

// RATE LIMITING PROTECTION
app.use(rateLimit({
  windowMs: 60 * 1000, // 1 Minute Window
  max: 60, // Limit each IP to 60 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests from this IP, please try again after a minute." }
}));

// Note: DB Connection logic (Supabase) is securely handled at the microservice level inside routes/places.js

// Routes
app.use('/api/places', require('./routes/places'));

// Root endpoint for testing
app.get('/', (req, res) => {
    res.json({ message: "Zipo Backend Engine API is Running" });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`Zipo Backend running on port ${PORT}`);
});
