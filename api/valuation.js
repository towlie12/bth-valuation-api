import OpenAI from "openai";
import { Resend } from "resend";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const resend = new Resend(process.env.RESEND_API_KEY);

// Helper to format money nicely
function formatAUD(value) {
  if (value == null || isNaN(value)) return "-";
  return Math.round(Number(value)).toLocaleString("en-AU");
}

// --- NEW: map categories to thumbnail URLs ---
const categoryImages = {
  cafe: "https://source.unsplash.com/600x400/?cafe,coffee-shop,interior",
  restaurant: "https://source.unsplash.com/600x400/?restaurant,dining,interior",
  retail: "https://source.unsplash.com/600x400/?retail,store,shop,interior",
  services: "https://source.unsplash.com/600x400/?office,workspace,team",
  trades: "https://source.unsplash.com/600x400/?workshop,industrial,warehouse",
  beauty: "https://source.unsplash.com/600x400/?salon,beauty,spa,interior",
  fitness: "https://source.unsplash.com/600x400/?gym,fitness,studio",
  healthcare: "https://source.unsplash.com/600x400/?clinic,medical,interior",
  automotive: "https://source.unsplash.com/600x400/?auto,garage,car,workshop",
  online: "https://source.unsplash.com/600x400/?ecommerce,online,business",
  generic: "https://source.unsplash.com/600x400/?small,business,interior",
};

// --- NEW: guess category from the free-text businessType ---
function inferCategory(businessTypeRaw = "") {
  const s = businessTypeRaw.toLowerCase();

  if (s.match(/\bcafe|coffee|espresso|coffee shop/)) return "cafe";
  if (s.match(/\brestaurant|bistro|takeaway|take-away|food truck|burger|pizza/))
    return "restaurant";
  if (s.match(/\bretail|shop|store|boutique|florist|grocery|supermarket/))
    return "retail";
  if (s.match(/\bsalon|barber|spa|beauty|nail/)) return "beauty";
  if (s.match(/\bgym|fitness|pilates|yoga|personal training/)) return "fitness";
  if (s.match(/\bclinic|medical|dental|dentist|physio|chiro|pharmacy/))
    return "healthcare";
  if (s.match(/\bauto|mechanic|panel beat|car wash|detailing|tyre/))
    return "automotive";
  if (s.match(/\bplumb|electric|air[- ]?con|hvac|construction|builder|trade/))
    return "trades";
  if (s.match(/\bonline|e[- ]?commerce|store\s*online|dropship|saas|software/))
    return "online";
  if (s.match(/\boffice|consult|accountant|law|legal|agency|marketing|design/))
    return "services";

  return "generic";
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

    // Basic validation
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
- listingTitle (short, compelling listing title for a marketplace)
- listingIntro (2–3 sentence paragraph as if it were the opening of a listing)
- listingBullets (array of 3–5 short bullet points highlighting key strengths)

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
- Make the listing text sound clear, confident and professional, not salesy.
`;

    // 1) Ask GPT for a valuation + listing teaser
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
      listingTitle,
      listingIntro,
      listingBullets,
    } = data;

    const lowStr = formatAUD(lowEstimate);
    const highStr = formatAUD(highEstimate);
    const recStr = formatAUD(recommendedPrice);

    // Convert line breaks to <br> for email
    const notesHtml = (notes || "").replace(/\n/g, "<br>");
    const improvementHtml = (improvementIdeas || "").replace(/\n/g, "<br>");

    const bulletsArray = Array.isArray(listingBullets) ? listingBullets : [];
    const bulletsHtml = bulletsArray
      .map((b) => `<li style="margin-bottom:4px;">${b}</li>`)
      .join("");

    const today = new Date();
    const issuedDate = today.toLocaleDateString("en-AU", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });

    // NEW: pick thumbnail URL based on inferred category
    const category = inferCategory(businessType);
    const thumbUrl = categoryImages[category] || categoryImages.generic;

    // 2) Build premium HTML email
    const html = `
  <div style="background-color:#f3f4f6;padding:32px 12px;">
    <div style="max-width:720px;margin:0 auto;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #e5e7eb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;box-shadow:0 18px 45px rgba(15,23,42,0.12);">

      <!-- Header -->
      <div style="background:linear-gradient(135deg,#020617,#0f766e);padding:20px 24px 22px;">
        <div style="font-size:18px;font-weight:600;color:#ffffff;">BizTradeHub</div>
        <div style="font-size:13px;color:#cbd5f5;margin-top:4px;">AI-powered business valuation report</div>
        <div style="font-size:11px;color:#e5e7eb;margin-top:10px;">
          Prepared for: <span style="font-weight:600;">${businessType}</span>
          &nbsp;•&nbsp; Issued: ${issuedDate}
        </div>
      </div>

      <!-- Main content -->
      <div style="padding:26px 26px 28px;">

        <h1 style="font-size:22px;margin:0 0 8px;">Your valuation estimate</h1>
        <p style="font-size:14px;line-height:1.6;margin:0 0 20px;color:#374151;">
          Based on the details you provided, your business could be worth approximately:
        </p>

        <!-- Big valuation block -->
        <div style="background:#f9fafb;border-radius:14px;padding:18px 20px;margin-bottom:20px;border:1px solid #e5e7eb;box-shadow:0 6px 18px rgba(15,23,42,0.04);">
          <div style="font-size:22px;font-weight:600;margin-bottom:4px;">
            $${lowStr} – $${highStr} AUD
          </div>
          <div style="font-size:14px;margin-bottom:10px;color:#111827;">
            Recommended listing price: <strong>$${recStr} AUD</strong>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:12px;font-size:12px;color:#4b5563;margin-top:4px;">
            <div><strong>Multiple:</strong> ${multipleRange || "-"}</div>
            <div><strong>Confidence:</strong> ${confidence || "Medium"}</div>
            <div><strong>Expected sale window:</strong> ${sellTime || "3–9 months"}</div>
          </div>
        </div>

        <!-- Executive summary -->
        <div style="background:#f3f4ff;border-radius:12px;padding:12px 14px;margin-bottom:24px;border:1px solid #e0e7ff;">
          <div style="font-size:13px;font-weight:600;margin-bottom:4px;color:#111827;">Executive summary</div>
          <ul style="padding-left:18px;margin:4px 0 0;font-size:13px;line-height:1.6;color:#374151;">
            <li>We estimate your business could sell in the range of <strong>$${lowStr} – $${highStr} AUD</strong>, with a recommended listing price of <strong>$${recStr} AUD</strong>.</li>
            <li>The estimate is based primarily on your reported owner's earnings of <strong>$${formatAUD(
              annualProfit
            )} AUD</strong> and typical sale multiples for similar businesses.</li>
            <li>Assuming normal market conditions, a realistic sale window is around <strong>${
              sellTime || "3–9 months"
            }</strong>.</li>
          </ul>
        </div>

        <!-- Based on what you told us -->
        <h2 style="font-size:16px;margin:0 0 10px;">Based on what you told us</h2>
        <table cellpadding="0" cellspacing="0" style="width:100%;font-size:13px;margin-bottom:22px;border-collapse:collapse;">
          <tbody>
            <tr>
              <td style="padding:4px 0;color:#6b7280;">Business type</td>
              <td style="padding:4px 0;text-align:right;font-weight:500;color:#111827;">${businessType}</td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:#6b7280;">Location</td>
              <td style="padding:4px 0;text-align:right;font-weight:500;color:#111827;">${location ||
                "-"}</td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:#6b7280;">Annual revenue</td>
              <td style="padding:4px 0;text-align:right;font-weight:500;color:#111827;">$${formatAUD(
                annualRevenue
              )} AUD</td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:#6b7280;">Annual profit / owner's earnings</td>
              <td style="padding:4px 0;text-align:right;font-weight:500;color:#111827;">$${formatAUD(
                annualProfit
              )} AUD</td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:#6b7280;">Years operating</td>
              <td style="padding:4px 0;text-align:right;font-weight:500;color:#111827;">${yearsOperating ||
                "-"}</td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:#6b7280;">Staff count</td>
              <td style="padding:4px 0;text-align:right;font-weight:500;color:#111827;">${staffCount ||
                "-"}</td>
            </tr>
          </tbody>
        </table>

        <!-- How this valuation was calculated -->
        <h2 style="font-size:16px;margin:0 0 8px;">How this valuation was calculated</h2>
        <p style="font-size:13px;line-height:1.6;margin:0 0 8px;color:#374151;">
          This estimate is based on typical sale price multiples for similar small businesses in Australia, adjusted for your industry, reported profit, and risk profile.
        </p>
        <p style="font-size:13px;line-height:1.6;margin:0 0 18px;color:#4b5563;">
          ${notesHtml || ""}
        </p>

        <!-- How to improve -->
        <h2 style="font-size:16px;margin:0 0 8px;">How to potentially improve your valuation</h2>
        <p style="font-size:13px;line-height:1.6;margin:0 0 22px;color:#4b5563;">
          ${improvementHtml || ""}
        </p>

        <!-- Listing teaser as a card with thumbnail -->
        <h2 style="font-size:16px;margin:0 0 8px;">How your listing could look</h2>
        <p style="font-size:13px;line-height:1.6;margin:0 0 12px;color:#4b5563;">
          Here's a short preview of how your business could appear on BizTradeHub:
        </p>

        <div style="display:flex;justify-content:center;margin-bottom:22px;">
          <div style="width:100%;max-width:320px;border-radius:18px;border:1px solid #e5e7eb;background:#ffffff;box-shadow:0 10px 30px rgba(15,23,42,0.08);overflow:hidden;">
            <!-- Thumbnail image -->
            <img src="${thumbUrl}" alt="Business thumbnail" style="width:100%;height:90px;object-fit:cover;display:block;">

            <!-- Card body -->
            <div style="padding:12px 14px 12px;">
              <div style="font-size:14px;font-weight:600;margin-bottom:2px;color:#111827;">
                ${listingTitle || "Profitable business opportunity"}
              </div>
              <div style="font-size:12px;color:#4b5563;margin-bottom:6px;">
                <span style="font-weight:600;">Asking price:</span> $${recStr} AUD
              </div>
              <div style="font-size:12px;color:#4b5563;margin-bottom:10px;line-height:1.5;">
                ${listingIntro || ""}
              </div>

              <div style="border-top:1px solid #e5e7eb;margin:8px 0 8px;"></div>

              <!-- Stats rows -->
              <table cellpadding="0" cellspacing="0" style="width:100%;font-size:12px;color:#4b5563;">
                <tbody>
                  <tr>
                    <td style="padding:4px 0;">Revenue</td>
                    <td style="padding:4px 0;text-align:right;font-weight:500;">$${formatAUD(
                      annualRevenue
                    )}/year</td>
                  </tr>
                  <tr>
                    <td style="padding:4px 0;">Profit</td>
                    <td style="padding:4px 0;text-align:right;font-weight:500;">$${formatAUD(
                      annualProfit
                    )}/year</td>
                  </tr>
                  <tr>
                    <td style="padding:4px 0;">Staff</td>
                    <td style="padding:4px 0;text-align:right;font-weight:500;">${staffCount ||
                      "-"} employees</td>
                  </tr>
                  <tr>
                    <td style="padding:4px 0;">Location</td>
                    <td style="padding:4px 0;text-align:right;font-weight:500;">${location ||
                      "-"}</td>
                  </tr>
                  <tr>
                    <td style="padding:4px 0;">Established</td>
                    <td style="padding:4px 0;text-align:right;font-weight:500;">${
                      yearsOperating || "N/A"
                    }+ years</td>
                  </tr>
                </tbody>
              </table>

              ${
                bulletsHtml
                  ? `<div style="border-top:1px solid #e5e7eb;margin:8px 0 6px;"></div>
                     <ul style="padding-left:16px;margin:4px 0 0;font-size:11px;color:#4b5563;line-height:1.5;">${bulletsHtml}</ul>`
                  : ""
              }

              <div style="margin-top:8px;font-size:10px;color:#9ca3af;text-align:center;">
                Demo preview – your full listing can include more details and photos.
              </div>
            </div>
          </div>
        </div>

        <!-- CTA -->
        <div style="margin:10px 0 6px;text-align:center;">
          <a href="https://biztradehub.com" style="display:inline-block;background:#111827;color:#ffffff;font-size:14px;font-weight:500;padding:11px 22px;border-radius:999px;text-decoration:none;">
            Start your listing – it only takes a few minutes
          </a>
        </div>

        <!-- Disclaimer -->
        <p style="font-size:11px;line-height:1.5;margin-top:18px;color:#9ca3af;">
          This is an AI-generated estimate only and does not constitute financial, legal, or taxation advice. 
          It is based solely on the figures you entered and general market benchmarks for small businesses in Australia. 
          For a formal valuation, please consult a qualified accountant, broker, or financial adviser.
        </p>
      </div>

      <!-- Footer -->
      <div style="background:#f9fafb;padding:10px 20px 14px;border-top:1px solid #e5e7eb;">
        <p style="margin:0;font-size:11px;color:#9ca3af;line-height:1.5;">
          BizTradeHub Pty Ltd · Sydney, Australia<br/>
          You’re receiving this email because you requested a business valuation on BizTradeHub.<br/>
          © ${today.getFullYear()} BizTradeHub. All rights reserved.
        </p>
      </div>

    </div>
  </div>
`;

    // 3) Send the email using Resend
    const { error: emailError } = await resend.emails.send({
      // Change this to your verified domain once ready:
      // from: "BizTradeHub <valuation@biztradehub.com>",
      from: "BizTradeHub <onboarding@resend.dev>",
      to: [email],
      subject: "Your BizTradeHub business valuation estimate",
      html,
    });

    if (emailError) {
      console.error("Resend email error:", emailError);
      // Still return 200 so Framer shows success
    }

    // 4) Return success to Framer
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Valuation error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
