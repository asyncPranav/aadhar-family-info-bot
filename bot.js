import TelegramBot from "node-telegram-bot-api";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

// Read environment variables
const TOKEN = process.env.TELEGRAM_TOKEN;
const API_BASE = process.env.AADHAR_API_BASE;
const ACCESS_CODE = process.env.ACCESS_CODE;
const SHOW_SENSITIVE = String(process.env.SHOW_SENSITIVE || "").toLowerCase() === "true";

if (!TOKEN || !API_BASE || !ACCESS_CODE) {
  console.error("❌ Missing required environment variables. Check TELEGRAM_TOKEN, AADHAR_API_BASE, ACCESS_CODE.");
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });
console.log("✅ Aadhaar Info Bot started. SHOW_SENSITIVE =", SHOW_SENSITIVE);

// Authorized users in memory
const authorizedUsers = {};

// Utility functions
function maskString(str, keepLast = 4) {
  if (!str) return "N/A";
  const s = String(str);
  return s.length <= keepLast ? "*".repeat(s.length) : "*".repeat(s.length - keepLast) + s.slice(-keepLast);
}

function maskName(name) {
  if (!name) return "N/A";
  return name[0].toUpperCase() + "." + "*".repeat(Math.max(0, name.length - 1));
}

function safeLine(label, value) {
  return `${label}: ${value ?? "N/A"}`;
}

// Bot commands
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    `👋 Hello ${msg.chat.first_name || ""}!\n\nWelcome to the **Aadhaar Info Bot** 🔍\n\nPlease enter your **access code** to continue.`,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/help/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    "📘 **How to use:**\n1. Send your access code.\n2. Once authorized, send any Aadhaar *family ID* to fetch details.\n\nExample: `116440054586`",
    { parse_mode: "Markdown" }
  );
});

// Message handler
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = String(msg.text || "").trim();

  if (!text || text.startsWith("/")) return;

  // Authorization check
  if (!authorizedUsers[chatId]) {
    if (text === ACCESS_CODE) {
      authorizedUsers[chatId] = true;
      bot.sendMessage(chatId, "✅ Access Granted! You can now send Aadhaar family IDs to fetch info.");
    } else {
      bot.sendMessage(chatId, "🔒 Access Restricted. Please enter the correct access code.");
    }
    return;
  }

  // Input validation (Aadhaar family ID)
  if (!/^\d{6,15}$/.test(text)) {
    bot.sendMessage(chatId, "⚠️ Please send a valid Aadhaar family ID (digits only). Example: `116440054586`");
    return;
  }

  try {
    await bot.sendMessage(chatId, "🔍 Fetching Aadhaar family info...");

    // Fetch data
    const url = `${API_BASE}${encodeURIComponent(text)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (!data || !data.memberDetailsList) {
      bot.sendMessage(chatId, "❌ No data found for this Aadhaar family ID.");
      return;
    }

    // Extract details
    const address = SHOW_SENSITIVE ? data.address : maskString(data.address, 6);
    const scheme = data.schemeName || "N/A";
    const district = data.homeDistName || "N/A";
    const state = data.homeStateName || "N/A";

    const members = data.memberDetailsList.map((m, i) => {
      const name = SHOW_SENSITIVE ? m.memberName : maskName(m.memberName);
      const relation = m.releationship_name || "N/A";
      const id = SHOW_SENSITIVE ? m.memberId : maskString(m.memberId, 4);
      return `${i + 1}. ${name} — ${relation}\n   🆔 ${id}`;
    }).join("\n\n");

    const message = [
      "🪪 **Aadhaar Family Info**",
      "────────────────────",
      safeLine("Scheme", scheme),
      safeLine("District", district),
      safeLine("State", state),
      safeLine("Address", address),
      "",
      "👨‍👩‍👧‍👦 **Members:**",
      members,
      "",
      SHOW_SENSITIVE
        ? "⚠️ Sensitive output is ENABLED. Handle with caution."
        : "🔒 Sensitive fields are masked. Set SHOW_SENSITIVE=true in .env to see full data."
    ].join("\n");

    await bot.sendMessage(chatId, message, { parse_mode: "Markdown" });

  } catch (err) {
    console.error("Error:", err);
    bot.sendMessage(chatId, `❌ Failed to fetch data: ${err.message}`);
  }
});
