
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");

const app = express();
const PORT = process.env.PORT || 3000;

const receiptsFile = path.join(__dirname, "receipts.json");

app.use(bodyParser.json());
app.use(cors({ origin: "*" }));

function readReceipts() {
  if (!fs.existsSync(receiptsFile)) return {};
  return JSON.parse(fs.readFileSync(receiptsFile));
}

function writeReceipts(data) {
  fs.writeFileSync(receiptsFile, JSON.stringify(data, null, 2));
}

function formatPhone(phone) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 9 && digits.startsWith("7")) return "254" + digits;
  if (digits.length === 10 && digits.startsWith("07"))
    return "254" + digits.substring(1);
  if (digits.length === 12 && digits.startsWith("254")) return digits;
  return null;
}

// 1️⃣ Initiate Payment
app.post("/pay", async (req, res) => {
  try {
    const { phone, amount } = req.body;
    const formattedPhone = formatPhone(phone);

    if (!formattedPhone)
      return res.status(400).json({ success: false, error: "Invalid phone format" });

    if (!amount || amount < 1)
      return res.status(400).json({ success: false, error: "Amount must be >= 1" });

    const reference = "ORDER-" + Date.now();

    const payload = {
      amount: Math.round(amount),
      phone_number: formattedPhone,
      external_reference: reference,
      customer_name: "Customer",
      callback_url: "https://aviator-server-stk.onrender.com/callback",
      channel_id: "000586"
    };

    const resp = await axios.post(
      "https://swiftwallet.co.ke/v3/stk-initiate/",
      payload,
      {
        headers: {
          Authorization: `Bearer YOUR_SWIFTWALLET_KEY`,
          "Content-Type": "application/json"
        }
      }
    );

    if (resp.data.success) {
      const receiptData = {
        reference,
        amount: Math.round(amount),
        phone: formattedPhone,
        status: "pending",
        timestamp: new Date().toISOString()
      };

      let receipts = readReceipts();
      receipts[reference] = receiptData;
      writeReceipts(receipts);

      res.json({
        success: true,
        message: "STK push sent",
        reference
      });
    } else {
      res.status(400).json({
        success: false,
        error: resp.data.error || "Failed to initiate payment"
      });
    }
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message || "Server error"
    });
  }
});

// 2️⃣ Callback handler
app.post("/callback", async (req, res) => {
  const data = req.body;
  const ref = data.external_reference;

  let receipts = readReceipts();
  const existingReceipt = receipts[ref] || {};

  const resultCode = data.result?.ResultCode;

  if (resultCode === 0) {

    receipts[ref] = {
      ...existingReceipt,
      status: "success",
      transaction_code: data.result?.MpesaReceiptNumber || null,
      amount: data.result?.Amount || existingReceipt.amount,
      phone: data.result?.Phone || existingReceipt.phone,
      timestamp: new Date().toISOString()
    };

    writeReceipts(receipts);

    // ✅ SAFE BALANCE UPDATE CALL TO DATABASE SERVER
    try {
      await axios.post("https://aviator-server-irsg.onrender.com/update-balance", {
        phone: receipts[ref].phone,
        amount: receipts[ref].amount
      });
      console.log("✅ Balance updated successfully in database");
    } catch (err) {
      console.error("❌ Failed to update database balance:", err.message);
    }

  } else {
    receipts[ref] = {
      ...existingReceipt,
      status: "failed",
      timestamp: new Date().toISOString()
    };

    writeReceipts(receipts);
  }

  res.json({ ResultCode: 0, ResultDesc: "Callback received" });
});

app.listen(PORT, () => {
  console.log(`🚀 STK Server running on port ${PORT}`);
});
