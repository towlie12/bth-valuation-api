import OpenAI from "openai";
import { Resend } from "resend";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const resend = new Resend(process.env.RESEND_API_KEY);

// helper to format money nicely
function formatAUD(value) {
  if (value == null || isNaN(value)) return "-";
  return Math.round(Number(value)).toLocaleString("en-AU");
}

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

Return ONLY JSON with these keys:
- lowEstimate (number, AUD)
- highEstimate (number, AUD)
- recommendedPrice (number, AUD)
- multipleRange (string, e.g. "2.1x–2.8x SDE")
- confidence (string, one of: "Low", "Medium", "High")
- sellTime (string, e.g. "3–6 months", "6–12 months")
- notes (string, 2–3 short bullet-style sentences joined with line breaks)
- improvementIdeas (string, 3 concise suggestions joined with line breaks)

Inputs:
- Business type: ${businessType}
- Location: ${location}
- Annual revenue: ${annualRevenue}
- Annual profit / owner's earnings: ${annualProfit}
- Years operating: ${yearsOperating}
- Staff count: ${staffCount}

Rules:
- Use realistic small-business multiples (typically 1x–4x of profit).
- Be slightly conservative.
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
      confidence,
      sellTime,
      notes,
      improvementIdeas,
    } = data;

    const lowStr = formatAUD(lowEstimate);
    const highStr = formatAUD(highEstimate);
    const recStr = formatAUD(recommendedPrice);

    // convert line-break text into HTML <br>
    const notesHtml = (notes || "").replace(/\n/g, "<br>");
    const improvementHtml = (improvementIdeas || "").replace(/\n/g, "<br>");

    // 2) Build a nicer HTML email
    const html = `
  <div style="background-color:#f5f5f5;padding:32px 0;">
    <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e5e5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111111;">
      
      <!-- Header -->
      <div style="background:linear-gradient(135deg,#111827,#0f766e);padding:20px 24px;">
        <div style="font-size:18px;font-weight:600;color:#ffffff;">BizTradeHub</div>
        <div style="font-size:13px;color:#d1d5db;margin-top:4px;">AI-powered business valuation estimate</div>
      </div>

      <!-- Main content -->
      <div style="padding:24px 24px 28px;">
        <h1 style="font-size:22px;margin:0 0 12px;">Your valuation estimate</h1>
        <p style="font-size:14px;line-height:1.6;margin:0 0 20px;">
          Based on the details you provided, your business could be worth approximately:
        </p>

        <!-- Big valuation block -->
        <div style="background:#f9fafb;border-radius:12px;padding:16px 18px;margin-bottom:20px;border:1px solid #e5e7eb;">
          <div style="font-size:20px;font-weight:600;margin-bottom:4px;">
            $${lowStr} – $${highStr} AUD
          </div>
          <div style="font-size:14px;margin-bottom:8px;">
            Recommended listing price: <strong>$${recStr} AUD</strong>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:12px;font-size:12px;color:#4b5563;margin-top:8px;">
            <div><strong>Multiple:</strong> ${multipleRange || "-"}</div>
            <div><strong>Confidence:</strong> ${confidence || "Medium"}</div>
            <div><strong>Typical sale time:</strong> ${sellTime || "3–9 months"}</div>
          </div>
        </div>

        <!-- Based on what you told us -->
        <h2 style="font-size:16px;margin:0 0 8px;">Based on what you told us</h2>
        <table cellpadding="0" cellspacing="0" style="width:100%;font-size:13px;margin-bottom:18px;border-collapse:collapse;">
          <tbody>
            <tr>
              <td style="padding:4px 0;color:#6b7280;">Business type</td>
              <td style="padding:4px 0;text-align:right;font-weight:500;">${businessType}</td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:#6b7280;">Location</td>
              <td style="padding:4px 0;text-align:right;font-weight:500;">${location || "-"}</td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:#6b7280;">Annual revenue</td>
              <td style="padding:4px 0;text-align:right;font-weight:500;">$${formatAUD(annualRevenue)} AUD</td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:#6b7280;">Annual profit / owner's earnings</td>
              <td style="padding:4px 0;text-align:right;font-weight:500;">$${formatAUD(annualProfit)} AUD</td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:#6b7280;">Years operating</td>
              <td style="padding:4px 0;text-align:right;font-weight:500;">${yearsOperating || "-"}</td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:#6b7280;">Staff count</td>
              <td style="padding:4px 0;text-align:right;font-weight:500;">${staffCount || "-"}</td>
            </tr>
          </tbody>
        </table>

        <!-- How this was calculated -->
        <h2 style="font-size:16px;margin:0 0 8px;">How this valuation was calculated</h2>
        <p style="font-size:13px;line-height:1.6;margin:0 0 8px;">
          This estimate is based on typical sale price multiples for similar small businesses, adjusted for your industry, profit level, and risk profile.
        </p>
        <p style="font-size:13px;line-height:1.6;margin:0 0 16px;color:#4b5563;">
          ${notesHtml || ""}
        </p>

        <!-- How to improve -->
        <h2 style="font-size:16px;margin:0 0 8px;">How to potentially improve your valuation</h2>
        <p style="font-size:13px;line-height:1.6;margin:0 0 16px;color:#4b5563;">
          ${improvementHtml || ""}
        </p>

        <!-- CTA -->
        <div style="margin:18px 0 8px;">
          <a href="https://biztradehub.com" style="display:inline-block;background:#111827;color:#ffffff;font-size:14px;font-weight:500;padding:10px 18px;border-radius:999px;text-decoration:none;">
            When you're ready, list your business on BizTradeHub
          </a>
        </div>

        <!-- Disclaimer -->
        <p style="font-size:11px;line-height:1.5;margin-top:18px;color:#9ca3af;">
          This is an AI-generated estimate only and does not constitute financial, legal, or taxation advice. 
          It is based solely on the figures you entered and general market benchmarks for small businesses in Australia. 
          For a formal valuation, please consult a qualified accountant, broker, or financial adviser.
        </p>
      </div>
    </div>
  </div>
`;

    // 3) Send the email using Resend
    const { error: emailError } = await resend.emails.send({
      //from: "BizTradeHub <valuation@biztradehub.com>", // use your verified domain here
      from: "BizTradeHub <onboarding@resend.dev>",
      to: [email],
      subject: "Your BizTradeHub business valuation estimate",
      html,
    });

    if (emailError) {
      console.error("Resend email error:", emailError);
      // still return 200 so Framer shows success
    }

    // 4) Return success to Framer
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Valuation error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
