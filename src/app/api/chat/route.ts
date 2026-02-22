import { GoogleGenAI, Type, type FunctionDeclaration, type Content, type Part } from "@google/genai";
import { createClient } from "@/lib/supabase/server";
import { toTimestamp, getTodayInTimezone, formatTimeInZone } from "@/lib/utils";

function getGenAI() {
  return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
}

// ---------------------------------------------------------------------------
// Gemini tool declarations
// ---------------------------------------------------------------------------

const toolDeclarations: FunctionDeclaration[] = [
  {
    name: "get_facility_info",
    description:
      "Get information about this facility including its bays, resource types, and pricing. Call this when the customer asks general questions about the facility.",
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: "get_available_slots",
    description:
      "Look up available time slots for a specific date. Returns slots grouped by bay with times and prices. Always call this to answer availability questions — never guess.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        date: {
          type: Type.STRING,
          description: "The date to check in YYYY-MM-DD format.",
        },
        bay_name: {
          type: Type.STRING,
          description:
            "Optional bay name filter. Only return slots for bays whose name contains this string (case-insensitive).",
        },
        resource_type: {
          type: Type.STRING,
          description:
            'Optional resource type filter, e.g. "Golf Simulator" or "Tennis Court".',
        },
      },
      required: ["date"],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool execution helpers
// ---------------------------------------------------------------------------

type OrgContext = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  description: string | null;
  address: string | null;
  phone: string | null;
};

async function executeFacilityInfo(org: OrgContext) {
  const supabase = await createClient();

  const { data: bays } = await supabase
    .from("bays")
    .select("name, resource_type, hourly_rate_cents, is_active")
    .eq("org_id", org.id)
    .eq("is_active", true)
    .order("sort_order")
    .order("created_at");

  return {
    name: org.name,
    description: org.description,
    address: org.address,
    phone: org.phone,
    timezone: org.timezone,
    bays: (bays ?? []).map((b) => ({
      name: b.name,
      resource_type: b.resource_type,
      hourly_rate: `$${(b.hourly_rate_cents / 100).toFixed(2)}`,
    })),
  };
}

async function executeAvailableSlots(
  org: OrgContext,
  args: { date: string; bay_name?: string; resource_type?: string }
) {
  const supabase = await createClient();

  // Validate date is within the bookable window
  const today = getTodayInTimezone(org.timezone);
  const maxDate = new Date(today + "T12:00:00");
  maxDate.setDate(maxDate.getDate() + 14);
  const maxDateStr = maxDate.toISOString().split("T")[0];

  if (args.date < today) {
    return { error: "That date is in the past.", slots: [] };
  }
  if (args.date > maxDateStr) {
    return {
      error: `We can only show availability up to 14 days ahead (through ${maxDateStr}).`,
      slots: [],
    };
  }

  // Get active bays, optionally filtered
  let bayQuery = supabase
    .from("bays")
    .select("id, name, resource_type")
    .eq("org_id", org.id)
    .eq("is_active", true);

  if (args.resource_type) {
    bayQuery = bayQuery.ilike("resource_type", `%${args.resource_type}%`);
  }

  const { data: bays } = await bayQuery.order("sort_order").order("created_at");

  if (!bays || bays.length === 0) {
    return { error: "No matching bays found.", slots: [] };
  }

  // Further filter by bay_name if provided
  const filteredBays = args.bay_name
    ? bays.filter((b) =>
        b.name.toLowerCase().includes(args.bay_name!.toLowerCase())
      )
    : bays;

  if (filteredBays.length === 0) {
    return { error: `No bays matching "${args.bay_name}" found.`, slots: [] };
  }

  // Compute timezone-aware day boundaries
  const nextDay = new Date(args.date + "T12:00:00");
  nextDay.setDate(nextDay.getDate() + 1);
  const nextDayStr = nextDay.toISOString().split("T")[0];

  const dayStart = toTimestamp(args.date, "00:00:00", org.timezone);
  const dayEnd = toTimestamp(nextDayStr, "00:00:00", org.timezone);

  // Get all available slots for this date
  const { data: allSlots } = await supabase
    .from("bay_schedule_slots")
    .select("id, start_time, end_time, price_cents, status, bay_schedule_id")
    .eq("org_id", org.id)
    .eq("status", "available")
    .gte("start_time", dayStart)
    .lt("start_time", dayEnd)
    .order("start_time");

  // Get bay_schedule records to map slots to bays
  const { data: schedules } = await supabase
    .from("bay_schedules")
    .select("id, bay_id")
    .eq("org_id", org.id)
    .eq("date", args.date);

  const scheduleToBay: Record<string, string> = {};
  if (schedules) {
    for (const s of schedules) {
      scheduleToBay[s.id] = s.bay_id;
    }
  }

  // Build bay ID set for filtering
  const bayIdSet = new Set(filteredBays.map((b) => b.id));
  const bayNameMap: Record<string, { name: string; resource_type: string | null }> = {};
  for (const b of filteredBays) {
    bayNameMap[b.id] = { name: b.name, resource_type: b.resource_type };
  }

  // Group slots by bay
  const grouped: Record<
    string,
    Array<{ time: string; price: string; slot_id: string }>
  > = {};

  if (allSlots) {
    for (const slot of allSlots) {
      const bayId = scheduleToBay[slot.bay_schedule_id];
      if (!bayId || !bayIdSet.has(bayId)) continue;

      const bayName = bayNameMap[bayId]?.name ?? "Unknown";
      if (!grouped[bayName]) grouped[bayName] = [];
      grouped[bayName].push({
        time: `${formatTimeInZone(slot.start_time, org.timezone)} - ${formatTimeInZone(slot.end_time, org.timezone)}`,
        price: `$${(slot.price_cents / 100).toFixed(2)}`,
        slot_id: slot.id,
      });
    }
  }

  if (Object.keys(grouped).length === 0) {
    return {
      message: `No available slots on ${args.date} for the requested bays.`,
      slots: [],
    };
  }

  return { date: args.date, availability: grouped };
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  const body = await request.json();
  const { facilitySlug, messages } = body as {
    facilitySlug: string;
    messages: Array<{ role: "user" | "model"; content: string }>;
  };

  if (!facilitySlug || !messages || messages.length === 0) {
    return Response.json({ error: "Missing facilitySlug or messages" }, { status: 400 });
  }

  if (!process.env.GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY environment variable is not set");
    return Response.json(
      { error: "Chat is not configured yet. Please add your GEMINI_API_KEY." },
      { status: 503 }
    );
  }

  // Resolve org
  const supabase = await createClient();
  const { data: org } = await supabase
    .from("organizations")
    .select("id, name, slug, timezone, description, address, phone")
    .eq("slug", facilitySlug)
    .single();

  if (!org) {
    return Response.json({ error: "Facility not found" }, { status: 404 });
  }

  // Build system instruction
  const { data: bays } = await supabase
    .from("bays")
    .select("name, resource_type, hourly_rate_cents")
    .eq("org_id", org.id)
    .eq("is_active", true)
    .order("sort_order")
    .order("created_at");

  const bayList =
    bays && bays.length > 0
      ? bays
          .map(
            (b) =>
              `- ${b.name} (${b.resource_type ?? "General"}) — $${(b.hourly_rate_cents / 100).toFixed(2)}/hr`
          )
          .join("\n")
      : "No bays configured yet.";

  const today = getTodayInTimezone(org.timezone);

  const systemInstruction = `You are a friendly and helpful booking assistant for ${org.name}. You help customers find available time slots and answer questions about the facility.

Facility: ${org.name}
${org.description ? `Description: ${org.description}` : ""}
${org.address ? `Address: ${org.address}` : ""}
${org.phone ? `Phone: ${org.phone}` : ""}
Timezone: ${org.timezone}

Available bays:
${bayList}

Today's date is ${today}.
Customers can book up to 14 days ahead.

Guidelines:
- Always use the get_available_slots tool to look up real-time availability. Never guess or make up availability.
- Use get_facility_info when the customer asks general questions about the facility or bays.
- Format times in 12-hour format (e.g., "9:00 AM").
- Format prices as dollars (e.g., "$45.00").
- Be concise and helpful. Use short paragraphs, not walls of text.
- If the customer wants to book, direct them to the booking page at /book for now.
- If the customer asks about a date more than 14 days away, let them know you can only show the next 14 days.
- When listing available slots, organize them clearly by bay name and time.`;

  // Convert messages to Gemini Content format
  const currentMessages: Content[] = messages.map((m) => ({
    role: m.role === "model" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  // Resolve tool calls server-side in a loop, then stream the final text response
  try {
    let finalText = "";

    // Tool call loop — up to 5 rounds to prevent infinite loops
    for (let i = 0; i < 5; i++) {
      const response = await getGenAI().models.generateContent({
        model: "gemini-2.0-flash",
        contents: currentMessages,
        config: {
          systemInstruction,
          tools: [{ functionDeclarations: toolDeclarations }],
        },
      });

      const candidate = response.candidates?.[0];
      if (!candidate) {
        finalText = "I'm sorry, I wasn't able to process that. Could you try again?";
        break;
      }

      const parts = candidate.content?.parts ?? [];

      // Check if there are function calls
      const functionCalls = parts.filter((p) => p.functionCall);

      if (functionCalls.length === 0) {
        // No tool calls — extract text response
        finalText = parts
          .filter((p) => p.text)
          .map((p) => p.text)
          .join("");
        break;
      }

      // Add the model's response (with function calls) to the conversation
      const modelParts: Part[] = parts.map((p) => {
        if (p.functionCall) {
          return { functionCall: p.functionCall } as Part;
        }
        return { text: p.text ?? "" } as Part;
      });

      currentMessages.push({ role: "model", parts: modelParts });

      // Execute each function call and build response parts
      const responseParts: Part[] = [];

      for (const part of functionCalls) {
        const call = part.functionCall!;
        let result: Record<string, unknown>;

        switch (call.name) {
          case "get_facility_info":
            result = await executeFacilityInfo(org as OrgContext);
            break;
          case "get_available_slots":
            result = await executeAvailableSlots(
              org as OrgContext,
              call.args as { date: string; bay_name?: string; resource_type?: string }
            );
            break;
          default:
            result = { error: `Unknown function: ${call.name}` };
        }

        responseParts.push({
          functionResponse: {
            name: call.name!,
            response: result,
          },
        } as Part);
      }

      // Add function responses to conversation
      currentMessages.push({ role: "user", parts: responseParts });
    }

    // Stream the final text back to the client
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        // Send the full text in chunks to simulate streaming
        const words = finalText.split(" ");
        let index = 0;
        const chunkSize = 3; // words per chunk

        function push() {
          if (index >= words.length) {
            controller.close();
            return;
          }
          const chunk = words.slice(index, index + chunkSize).join(" ");
          const suffix = index + chunkSize < words.length ? " " : "";
          controller.enqueue(encoder.encode(chunk + suffix));
          index += chunkSize;
          // Small delay would be nice but ReadableStream start is sync
          // The client will see progressive chunks as they arrive
          push();
        }
        push();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Transfer-Encoding": "chunked",
      },
    });
  } catch (error) {
    console.error("Chat API error:", error);
    const message =
      error instanceof Error ? error.message : "Unknown error";
    // Surface specific Gemini errors to help debugging
    if (message.includes("API key")) {
      return Response.json(
        { error: "Invalid Gemini API key. Please check your GEMINI_API_KEY." },
        { status: 401 }
      );
    }
    return Response.json(
      { error: "Failed to generate response. Please try again." },
      { status: 500 }
    );
  }
}
