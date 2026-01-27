import OpenAI from "openai";
import { Resend } from "resend";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const resend = new Resend(process.env.RESEND_API_KEY);

// Helper to format money nicely
function formatAUD(value) {
  if (value == null || isNaN(value)) return "-";
  return Math.round(Number(value)).toLocaleString("en-AU");
}

// Category → thumbnail URLs on YOUR domain
const BASE_THUMB = "https://bth-valuation-api.vercel.app/thumbnails";

const categoryImages = {
  cafe: `${BASE_THUMB}/cafe.jpg`,
  restaurant: `${BASE_THUMB}/restaurant.jpg`,
  retail: `${BASE_THUMB}/retail.jpg`,
  services: `${BASE_THUMB}/services.jpg`,
  trades: `${BASE_THUMB}/trades.jpg`,
  beauty: `${BASE_THUMB}/beauty.jpg`,
  fitness: `${BASE_THUMB}/fitness.jpg`,
  healthcare: `${BASE_THUMB}/healthcare.jpg`,
  automotive: `${BASE_THUMB}/automotive.jpg`,
  online: `${BASE_THUMB}/online.jpg`,
  generic: `${BASE_THUMB}/generic.jpg`,
};

const allowedCategories = Object.keys(categoryImages);

// Guess category from the free-text businessType
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
- imageCategory (string, one of: "cafe", "restaurant", "retail", "services", "trades", "beauty", "fitness", "healthcare", "automotive", "online", "generic")

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
- For imageCategory, choose the single best-fitting category from the allowed list only.
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
      imageCategory,
    } = data;

    const lowStr = formatAUD(lowEstimate);
    const highStr = formatAUD(highEstimate);
    const recStr = formatAUD(recommendedPrice);

    // Convert line breaks to <br> for email
    const notesHtml = (notes || "").replace(/\n/g, "<br>");
    const improvementHtml = (improvementIdeas || "").replace(/\n/g, "<br>");

    // Trim listing content: first sentence + first 3 bullets
    const shortIntro =
      (listingIntro || "").split(/(?<=\.)\s+/)[0] || listingIntro || "";

    const bulletsArray = Array.isArray(listingBullets)
      ? listingBullets.slice(0, 3)
      : [];

    const bulletsHtml = bulletsArray
      .map((b) => `<li style="margin-bottom:4px;">${b}</li>`)
      .join("");

    const today = new Date();
    const issuedDate = today.toLocaleDateString("en-AU", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });

    // Choose image category: GPT's value first, then fallback to heuristic
    let chosenCategory;
    if (typeof imageCategory === "string") {
      const lowered = imageCategory.toLowerCase().trim();
      if (allowedCategories.includes(lowered)) {
        chosenCategory = lowered;
      }
    }
    if (!chosenCategory) {
      chosenCategory = inferCategory(businessType);
    }

    const thumbUrl =
      categoryImages[chosenCategory] || categoryImages.generic;

// 2) Build responsive HTML email (mobile-first, desktop enhanced)
const html = `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="x-apple-disable-message-reformatting">
    <title>BizTradeHub Valuation</title>

    <style>
      /* ===== Email-safe resets ===== */
      html, body { margin:0 !important; padding:0 !important; height:100% !important; width:100% !important; }
      * { -ms-text-size-adjust:100%; -webkit-text-size-adjust:100%; }
      table, td { mso-table-lspace:0pt; mso-table-rspace:0pt; border-collapse:collapse !important; }
      img { -ms-interpolation-mode:bicubic; border:0; outline:none; text-decoration:none; display:block; }
      a { text-decoration:none; }
      /* ===== Utilities ===== */
      .container { width:100%; max-width:640px; margin:0 auto; }
      .px { padding-left:24px; padding-right:24px; }
      .muted { color:#6b7280; }
      .text { color:#111827; }
      .btn { display:inline-block; background:#111827; color:#ffffff; font-weight:600; border-radius:999px; padding:12px 18px; }
      .card { background:#ffffff; border:1px solid #e5e7eb; border-radius:18px; overflow:hidden; }
      .softcard { background:#f9fafb; border:1px solid #e5e7eb; border-radius:14px; }
      .shadow { box-shadow:0 18px 45px rgba(15,23,42,0.12); }
      .shadow-soft { box-shadow:0 8px 22px rgba(15,23,42,0.08); }

      /* ===== Listing preview responsiveness =====
         Mobile FIRST: stack (block). Desktop: two columns.
      */
      .lp-col { width:100%; display:block; }
      .lp-gap { height:16px; line-height:16px; font-size:16px; }
      .cta-wrap { padding-top:6px; }

      /* Desktop enhancement */
      @media screen and (min-width: 680px) {
        .lp-row { display:table; width:100%; }
        .lp-col { display:table-cell; vertical-align:top; }
        .lp-left { width:340px; padding-right:16px; }
        .lp-right { width:auto; }
        .lp-gap { display:none; height:0; line-height:0; font-size:0; }
      }

      /* Mobile spacing tweaks */
      @media screen and (max-width: 480px) {
        .px { padding-left:16px !important; padding-right:16px !important; }
        h1 { font-size:20px !important; }
        .btn { display:block !important; text-align:center !important; }
      }
    </style>
  </head>

  <body style="background:#f3f4f6;">
    <!-- Preheader (hidden preview text) -->
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
      Your BizTradeHub valuation estimate is ready — view your recommended listing price and next steps.
    </div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;">
      <tr>
        <td style="padding:32px 12px;">

          <!-- Outer card -->
          <table role="presentation" class="container card shadow" cellpadding="0" cellspacing="0" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
            <!-- Header -->
            <tr>
              <td style="background:linear-gradient(135deg,#020617,#0f766e); padding:20px 24px 22px;">
                <div style="font-size:18px;font-weight:700;color:#ffffff;">BizTradeHub</div>
                <div style="font-size:13px;color:#cbd5f5;margin-top:4px;">AI-powered business valuation report</div>
                <div style="font-size:11px;color:#e5e7eb;margin-top:10px;">
                  Prepared for: <span style="font-weight:700;">${businessType}</span>
                  &nbsp;•&nbsp; Issued: ${issuedDate}
                </div>
              </td>
            </tr>

            <!-- Body -->
            <tr>
              <td class="px" style="padding-top:26px;padding-bottom:28px;color:#111827;">

                <h1 style="font-size:22px; margin:0 0 8px; color:#111827;">Your valuation estimate</h1>
                <p style="font-size:14px; line-height:1.6; margin:0 0 20px; color:#374151;">
                  Based on the details you provided, your business could be worth approximately:
                </p>

                <!-- Big valuation block -->
                <div class="softcard" style="padding:18px 20px; margin-bottom:20px; box-shadow:0 6px 18px rgba(15,23,42,0.04);">
                  <div style="font-size:18px;font-weight:700;margin-bottom:4px;color:#111827;">
                    Recommended listing price: <span style="font-size:20px;">$${recStr} AUD</span>
                  </div>

                  <div style="font-size:13px;margin-bottom:8px;color:#4b5563;">
                    Estimated sale range: <strong>$${lowStr} – $${highStr} AUD</strong>
                  </div>

                  <div style="font-size:12px;color:#4b5563;line-height:1.6;margin-top:4px;">
                    <div><strong>Multiple:</strong> ${multipleRange || "-"}</div>
                    <div><strong>Confidence:</strong> ${confidence || "Medium"}</div>
                    <div><strong>Expected sale window:</strong> ${sellTime || "3–9 months"}</div>
                  </div>
                </div>

                <!-- Executive summary -->
                <div style="background:#f3f4ff;border:1px solid #e0e7ff;border-radius:12px;padding:12px 14px;margin-bottom:20px;">
                  <div style="font-size:13px;font-weight:700;margin-bottom:4px;color:#111827;">Executive summary</div>
                  <ul style="padding-left:18px;margin:6px 0 0;font-size:13px;line-height:1.7;color:#374151;">
                    <li>We estimate your business could sell in the range of <strong>$${lowStr} – $${highStr} AUD</strong>, with a recommended listing price of <strong>$${recStr} AUD</strong>.</li>
                    <li>The estimate is based primarily on your reported owner's earnings of <strong>$${formatAUD(annualProfit)} AUD</strong> and typical sale multiples for similar businesses.</li>
                    <li>Assuming normal market conditions, a realistic sale window is around <strong>${sellTime || "3–9 months"}</strong>.</li>
                  </ul>
                </div>

                <!-- Listing preview -->
                <h2 style="font-size:16px;margin:0 0 6px;color:#111827;">See how your business would appear to buyers</h2>
                <p style="font-size:13px;line-height:1.6;margin:0 0 12px;color:#4b5563;">
                  Here’s how your business could look as a live listing on BizTradeHub, based on the details you provided:
                </p>

                <!-- Mobile-first stack; desktop becomes 2-col via CSS -->
                <div class="lp-row" style="margin-bottom:22px;">

                  <!-- LEFT / TOP: listing card -->
                  <div class="lp-col lp-left">
                    <div class="card shadow-soft" style="max-width:360px;">
                      <div style="width:100%; height:150px; background:#e5e7eb; overflow:hidden;">
                        <img src="${thumbUrl}" alt="" style="width:100%;height:150px;object-fit:cover;">
                      </div>

                      <div style="padding:12px 14px 12px;">
                        <div style="font-size:14px;font-weight:700;margin-bottom:4px;color:#111827;">
                          ${listingTitle || "Profitable business opportunity"}
                        </div>

                        <div style="font-size:12px;color:#4b5563;margin-bottom:8px;">
                          <span style="font-weight:700;">Asking price:</span> $${recStr} AUD
                        </div>

                        ${
                          shortIntro
                            ? `<div style="font-size:12px;color:#4b5563;margin-bottom:10px;line-height:1.55;">
                                 ${shortIntro}
                               </div>`
                            : ""
                        }

                        <div style="border-top:1px solid #e5e7eb;margin:8px 0 10px;"></div>

                        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="font-size:12px;color:#4b5563;">
                          <tr>
                            <td style="padding:4px 0;">Revenue</td>
                            <td style="padding:4px 0;text-align:right;font-weight:600;">$${formatAUD(annualRevenue)}/year</td>
                          </tr>
                          <tr>
                            <td style="padding:4px 0;">Profit</td>
                            <td style="padding:4px 0;text-align:right;font-weight:600;">$${formatAUD(annualProfit)}/year</td>
                          </tr>
                          <tr>
                            <td style="padding:4px 0;">Staff</td>
                            <td style="padding:4px 0;text-align:right;font-weight:600;">${staffCount || "-"} employees</td>
                          </tr>
                          <tr>
                            <td style="padding:4px 0;">Location</td>
                            <td style="padding:4px 0;text-align:right;font-weight:600;">${location || "-"}</td>
                          </tr>
                        </table>

                        ${
                          bulletsHtml
                            ? `<div style="border-top:1px solid #e5e7eb;margin:10px 0 6px;"></div>
                               <ul style="padding-left:16px;margin:6px 0 0;font-size:11px;color:#4b5563;line-height:1.55;">
                                 ${bulletsHtml}
                               </ul>`
                            : ""
                        }

                        <div style="margin-top:10px;font-size:10px;color:#9ca3af;text-align:center;">
                          Demo preview – your full listing can include more details and photos.
                        </div>
                      </div>
                    </div>
                  </div>

                  <div class="lp-gap">&nbsp;</div>

                  <!-- RIGHT / BELOW: copy + CTA -->
                  <div class="lp-col lp-right">
                    <div style="font-size:13px;color:#4b5563;line-height:1.65;">
                      <p style="margin:0 0 10px;">
                        This is an example of how buyers would see your business on BizTradeHub: professional layout, clear financials, and a concise story that highlights why your business is attractive.
                      </p>
                      <p style="margin:0 0 8px;">When you create a listing, we’ll guide you through:</p>
                      <ul style="margin:0 0 12px 16px;padding:0;line-height:1.55;">
                        <li>Structuring your listing to appeal to serious buyers</li>
                        <li>Presenting revenue, profit, and staff in a simple, trusted format</li>
                        <li>Standing out against generic listings on other marketplaces</li>
                      </ul>
                      <p style="margin:0 0 12px;">
                        You already have the numbers. Turning this into a live listing usually takes just a few minutes.
                      </p>

                      <div class="cta-wrap">
                        <a href="https://biztradehub.com"
                           class="btn"
                           style="display:inline-block;background:#111827;color:#ffffff;font-size:14px;font-weight:600;padding:12px 18px;border-radius:999px;">
                          Start your listing from this estimate
                        </a>
                      </div>
                    </div>
                  </div>

                </div>

                <!-- Based on what you told us -->
                <h2 style="font-size:16px;margin:0 0 10px;color:#111827;">Based on what you told us</h2>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;margin-bottom:22px;">
                  <tr>
                    <td style="padding:4px 0;color:#6b7280;">Business type</td>
                    <td style="padding:4px 0;text-align:right;font-weight:600;color:#111827;">${businessType}</td>
                  </tr>
                  <tr>
                    <td style="padding:4px 0;color:#6b7280;">Location</td>
                    <td style="padding:4px 0;text-align:right;font-weight:600;color:#111827;">${location || "-"}</td>
                  </tr>
                  <tr>
                    <td style="padding:4px 0;color:#6b7280;">Annual revenue</td>
                    <td style="padding:4px 0;text-align:right;font-weight:600;color:#111827;">$${formatAUD(annualRevenue)} AUD</td>
                  </tr>
                  <tr>
                    <td style="padding:4px 0;color:#6b7280;">Annual profit / owner's earnings</td>
                    <td style="padding:4px 0;text-align:right;font-weight:600;color:#111827;">$${formatAUD(annualProfit)} AUD</td>
                  </tr>
                  <tr>
                    <td style="padding:4px 0;color:#6b7280;">Years operating</td>
                    <td style="padding:4px 0;text-align:right;font-weight:600;color:#111827;">${yearsOperating || "-"}</td>
                  </tr>
                  <tr>
                    <td style="padding:4px 0;color:#6b7280;">Staff count</td>
                    <td style="padding:4px 0;text-align:right;font-weight:600;color:#111827;">${staffCount || "-"}</td>
                  </tr>
                </table>

                <!-- How calculated -->
                <h2 style="font-size:16px;margin:0 0 8px;color:#111827;">How this valuation was calculated</h2>
                <p style="font-size:13px;line-height:1.65;margin:0 0 8px;color:#374151;">
                  This estimate is based on typical sale price multiples for similar small businesses in Australia, adjusted for your industry, reported profit, and risk profile.
                </p>
                <p style="font-size:13px;line-height:1.65;margin:0 0 18px;color:#4b5563;">
                  ${notesHtml || ""}
                </p>

                <!-- Improve -->
                <h2 style="font-size:16px;margin:0 0 8px;color:#111827;">How to potentially improve your valuation</h2>
                <p style="font-size:13px;line-height:1.65;margin:0 0 22px;color:#4b5563;">
                  ${improvementHtml || ""}
                </p>

                <!-- Disclaimer -->
                <p style="font-size:11px;line-height:1.55;margin-top:8px;color:#9ca3af;">
                  This is an AI-generated estimate only and does not constitute financial, legal, or taxation advice.
                  It is based solely on the figures you entered and general market benchmarks for small businesses in Australia.
                  For a formal valuation, please consult a qualified accountant, broker, or financial adviser.
                </p>

              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="background:#f9fafb;padding:12px 20px 16px;border-top:1px solid #e5e7eb;">
                <p style="margin:0;font-size:11px;color:#9ca3af;line-height:1.5;">
                  BizTradeHub Pty Ltd · Sydney, Australia<br>
                  You’re receiving this email because you requested a business valuation on BizTradeHub.<br>
                  © ${today.getFullYear()} BizTradeHub. All rights reserved.
                </p>
              </td>
            </tr>
          </table>

        </td>
      </tr>
    </table>
  </body>
</html>
`;

    // 3) Send the email using Resend
    const { error: emailError } = await resend.emails.send({
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
