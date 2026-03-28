import { Resend } from "resend";
import { NextResponse } from "next/server";
import { z } from "zod/v4";

const leadSchema = z.object({
  type: z.enum(["contact", "demo"]),
  name: z.string().min(1).max(200),
  email: z.string().email().max(320),
  phone: z.string().max(30).optional(),
  company: z.string().max(200).optional(),
  facilityType: z.string().max(100).optional(),
  locations: z.string().max(20).optional(),
  message: z.string().max(2000).optional(),
});

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const TO_EMAIL = "anthony@sidelineswap.com";
const FROM_EMAIL = "EZBooker <noreply@updates.ezbooker.app>";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = leadSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
    }

    const { type, name, email, phone, company, facilityType, locations, message } = parsed.data;

    if (!resend) {
      console.error("[lead] Resend not configured (RESEND_API_KEY missing)");
      return NextResponse.json({ error: "Email service not configured" }, { status: 500 });
    }

    const isDemo = type === "demo";
    const subject = isDemo
      ? `New EZBooker Demo Request from ${name}`
      : `New EZBooker Contact from ${name}`;

    const lines = [
      `Type: ${isDemo ? "Demo Request" : "Contact Form"}`,
      `Name: ${name}`,
      `Email: ${email}`,
    ];

    if (phone) lines.push(`Phone: ${phone}`);
    if (company) lines.push(`Company: ${company}`);
    if (facilityType) lines.push(`Facility Type: ${facilityType}`);
    if (locations) lines.push(`Number of Locations: ${locations}`);
    if (message) lines.push(`\nMessage:\n${message}`);

    await resend.emails.send({
      from: FROM_EMAIL,
      to: TO_EMAIL,
      subject,
      text: lines.join("\n"),
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[lead] Failed to process lead:", err);
    return NextResponse.json({ error: "Failed to send" }, { status: 500 });
  }
}
