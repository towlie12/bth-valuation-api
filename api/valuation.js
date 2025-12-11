import OpenAI from "openai";
// import { Resend } from "resend"; // email optional

// Load OpenAI
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
// const resend = new Resend(process.env.RESEND_API_KEY); // optional

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const {
      businessType,
      location,
      annualRevenue,
      annualProfit,
      yearsOperating,
      staffCount,
      email
    } = req.body || {};

    if (!businessType || !annualProfit || !email) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const prompt = `
You are a small-business valuation assistant for AU.

Estimate sale price using realistic SDE multiples (1x–4x).

Return ONLY JSON with:
lowEstimate (AUD number)
highEstimate (AUD number)
recommendedPrice (AUD number)
multipleRange (string)
notes (string, 2–3 short bullet sentences)

Inputs:
Business type: ${businessType}
Location: ${location}
Annual revenue: ${annualRevenue}
Annual profit: ${annualProfit}
Years operating: ${yearsOperating}
Staff count: ${staffCount}
`;

    const completion = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" }
    });

    const data = JSON.parse(completion.choices[0].message.content);

    // Optionally send email using Resend here…

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
}
