import OpenAI from "openai";
import { Resend } from "resend";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const resend = new Resend(process.env.RESEND_API_KEY);

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
      email,
    } = req.body || {};

    // basic validation
    if (!businessType || !annualProfit || !email) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const prompt = `
You are a small-business valuation assistant for Australia.

Estimate a realistic SALE price range using SDE (owner's earnings) multiples.

Return ONLY JSON with:
- lowEstimate (number, AUD)
- highEstimate (number, AUD)
- recommendedPrice (number, AUD)
- multipleRange (string, e.g. "2.1x–2.8x SDE")
- notes (string with 2–3 short bullet-style sentences)

Inputs:
- Business type: ${businessType}
- Location: ${location}
- Annual revenue: ${annualRevenue}
- Annual profit / owner's earnings: ${annualProfit}
- Years operating: ${yearsOperating}
- Staff count: ${staffCount}

Rules:
- Use realistic small-business multiples (typically 1x–4x of profit).
- Adjust for risk: younger, niche, or unstable businesses get lower multiples.
- Currency is AUD.
`;

    // 1) Ask GPT for a valuation
    const completion = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    });

    const data = JSON.parse(completion.choices[0].message.content || "{}");
    const {
      lowEstimate,
      highEstimate,
      recommendedPrice,
      multipleRange,
      notes,
    } = data;

    // 2) Send the email using Resend
    const { error: emailError } = await resend.emails.send({
      from: "BizTradeHub <onboarding@resend.dev>", // dev-friendly default
      to: [email],
      subject: "Your BizTradeHub business valuation estimate",
      html: `
        <h1>Your valuation estimate</h1>
        <p>Based on the details you provided, your business could be worth approximately:</p>
        <p><strong>
          $${Math.round(lowEstimate).toLocaleString("en-AU")} – 
          $${Math.round(highEstimate).toLocaleString("en-AU")} AUD
        </strong></p>
        <p>Recommended listing price: 
          <strong>$${Math.round(recommendedPrice).toLocaleString("en-AU")} AUD</strong>
        </p>
        <p>Multiple range: ${multipleRange}</p>
        <p>${notes}</p>
        <p style="font-size:12px;color:#666;">
          This is an AI-generated estimate only and does not constitute financial advice.
        </p>
      `,
    });

    if (emailError) {
      console.error("Resend email error:", emailError);
      // Still return 200 so Framer doesn't show an error to the user
    }

    // 3) Return success to Framer
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Valuation error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
