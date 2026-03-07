import { Resend } from "resend";
import { NextResponse } from "next/server";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const TO_EMAIL = "anthony@sidelineswap.com";
const FROM_EMAIL = "EZBooker <noreply@updates.ezbooker.app>";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { type, name, email, phone, company, facilityType, locations, message } = body;

    if (!name || !email || !type) {
      return NextResponse.json({ error: "Name, email, and type are required" }, { status: 400 });
    }

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
