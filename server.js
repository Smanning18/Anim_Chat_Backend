const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const session = require("express-session");
const path = require("path");
const auth = require("./middleware/auth");
const users = require("./db/users");
require("dotenv").config();

const app = express();

// Middleware
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://dazzling-nash7-rabh7.dev-2.tempolabs.ai",
    ],
    credentials: true,
  }),
);
app.use(morgan("dev")); // Logs incoming requests
app.use(express.json());

// Session middleware
app.use(
  session({
    secret: process.env.JWT_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: { secure: process.env.NODE_ENV === "production" },
  }),
);

// API Routes
app.get("/api/health", (req, res) => {
  res.json({ message: "Server is running" });
});

// Auth routes
app.post("/api/register", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (users.has(username)) {
      return res.status(400).json({ error: "Username already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    users.set(username, { username, password: hashedPassword });

    const token = jwt.sign({ username }, process.env.JWT_SECRET, {
      expiresIn: "24h",
    });
    res.status(201).json({ token });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = users.get(username);

    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign({ username }, process.env.JWT_SECRET, {
      expiresIn: "24h",
    });
    res.json({ token });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const { getCharacterPrompt } = require("./characters");
const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// In-memory conversation history store
const conversationHistory = new Map();

// Constants
const MAX_HISTORY_LENGTH = 6;
const DEFAULT_TEMPERATURE = 0.8;

// Protected chat route
app.post("/api/chat", auth, async (req, res) => {
  const { userMessage, characterId } = req.body;

  // Retrieve the current conversation history from session or start with an empty array
  const conversationHistory = req.session?.chatHistory || [];

  try {
    // Optionally, adjust temperature based on additional parameters from the client
    const temperature = req.body.temperature || DEFAULT_TEMPERATURE;

    // Get character's system prompt
    const systemPrompt = getCharacterPrompt(characterId);

    // Prepare messages array with system prompt and history
    const messages = [
      { role: "system", content: systemPrompt },
      ...conversationHistory,
      { role: "user", content: userMessage },
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages,
      temperature,
      max_tokens: 150,
    });

    const aiResponse = completion.choices[0].message.content;

    // Update the session history with the new exchange
    if (req.session) {
      req.session.chatHistory = [
        ...conversationHistory,
        { role: "user", content: userMessage },
        { role: "assistant", content: aiResponse },
      ];
    }

    res.json({
      response: aiResponse,
      characterId,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Chat error:", error);
    res.status(500).json({
      error: error.message || "Failed to process chat message",
    });
  }
});

// Clear conversation history
app.post("/api/chat/clear", auth, (req, res) => {
  if (req.session) {
    req.session.chatHistory = [];
  }
  res.json({ message: "Conversation history cleared" });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Something broke!" });
});

// Serve static files in production
if (process.env.NODE_ENV === "production") {
  // Serve static files from the React build directory
  app.use(express.static(path.join(__dirname, "../dist")));

  // Handle React routing, return all requests to React app
  app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "../dist", "index.html"));
  });
}

const PORT = process.env.PORT || 5000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server is running on port ${PORT}`);
});
