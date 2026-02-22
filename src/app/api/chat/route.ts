import { GoogleGenAI, Type, type FunctionDeclaration, type Content, type Part } from "@google/genai";
import { createClient } from "@/lib/supabase/server";
import { toTimestamp, getTodayInTimezone, formatTimeInZone } from "@/lib/utils";
import { getAuthUser } from "@/lib/auth";

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
  {
    name: "get_my_bookings",
    description:
      "Get the current customer's bookings. Returns upcoming and recent bookings with confirmation codes, times, bay names, and status. Only works for authenticated users.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        status_filter: {
          type: Type.STRING,
          description:
            'Optional filter: "confirmed" for active bookings, "cancelled" for cancelled ones. Defaults to showing confirmed bookings.',
        },
      },
    },
  },
  {
    name: "create_booking",
    description:
      "Create a booking for the customer. Requires slot_ids from a previous get_available_slots call. IMPORTANT: Always confirm the booking details with the customer BEFORE calling this tool.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        slot_ids: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description:
            "Array of slot IDs to book. These must come from a prior get_available_slots response.",
        },
        notes: {
          type: Type.STRING,
          description: "Optional notes from the customer about the booking.",
        },
      },
      required: ["slot_ids"],
    },
  },
  {
    name: "cancel_booking",
    description:
      "Cancel an existing booking by its confirmation code. IMPORTANT: Always confirm the cancellation with the customer BEFORE calling this tool.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        confirmation_code: {
          type: Type.STRING,
          description:
            "The booking confirmation code (e.g., PB-ABC123). Get this from get_my_bookings if the customer doesn't know it.",
        },
      },
      required: ["confirmation_code"],
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

async function executeGetMyBookings(
  org: OrgContext,
  customerId: string | null,
  args: { status_filter?: string }
) {
  if (!customerId) {
    return { error: "You need to be signed in to view your bookings. Please log in first." };
  }

  const supabase = await createClient();
  const statusFilter = args.status_filter || "confirmed";

  const { data: bookings } = await supabase
    .from("bookings")
    .select("id, bay_id, date, start_time, end_time, total_price_cents, status, confirmation_code, notes")
    .eq("org_id", org.id)
    .eq("customer_id", customerId)
    .eq("status", statusFilter)
    .order("start_time", { ascending: true })
    .limit(20);

  if (!bookings || bookings.length === 0) {
    return { message: `No ${statusFilter} bookings found.`, bookings: [] };
  }

  // Get bay names
  const bayIds = [...new Set(bookings.map((b) => b.bay_id))];
  const { data: bays } = await supabase
    .from("bays")
    .select("id, name")
    .in("id", bayIds);

  const bayNameMap: Record<string, string> = {};
  if (bays) {
    for (const b of bays) {
      bayNameMap[b.id] = b.name;
    }
  }

  return {
    bookings: bookings.map((b) => ({
      confirmation_code: b.confirmation_code,
      bay: bayNameMap[b.bay_id] ?? "Unknown",
      date: b.date,
      time: `${formatTimeInZone(b.start_time, org.timezone)} - ${formatTimeInZone(b.end_time, org.timezone)}`,
      total_price: `$${(b.total_price_cents / 100).toFixed(2)}`,
      status: b.status,
      notes: b.notes,
    })),
  };
}

async function executeCreateBooking(
  org: OrgContext,
  customerId: string | null,
  args: { slot_ids: string[]; notes?: string }
) {
  if (!customerId) {
    return { error: "You need to be signed in to make a booking. Please log in first." };
  }

  if (!args.slot_ids || args.slot_ids.length === 0) {
    return { error: "No slots selected. Please choose time slots first." };
  }

  const supabase = await createClient();

  // Look up the slots to get bay and date info
  const { data: slots } = await supabase
    .from("bay_schedule_slots")
    .select("id, bay_schedule_id, start_time, end_time, price_cents, status")
    .in("id", args.slot_ids)
    .eq("org_id", org.id);

  if (!slots || slots.length === 0) {
    return { error: "Could not find the selected slots. They may no longer be available." };
  }

  // Check all slots are still available
  const unavailable = slots.filter((s) => s.status !== "available");
  if (unavailable.length > 0) {
    return { error: "Some of the selected slots are no longer available. Please check availability again." };
  }

  // Get bay_schedule records to map to bays and dates
  const scheduleIds = [...new Set(slots.map((s) => s.bay_schedule_id))];
  const { data: schedules } = await supabase
    .from("bay_schedules")
    .select("id, bay_id, date")
    .in("id", scheduleIds);

  if (!schedules || schedules.length === 0) {
    return { error: "Could not resolve bay information for the selected slots." };
  }

  const scheduleToBay: Record<string, { bay_id: string; date: string }> = {};
  for (const s of schedules) {
    scheduleToBay[s.id] = { bay_id: s.bay_id, date: s.date };
  }

  // Group slot IDs by bay
  const slotsByBay: Record<string, { date: string; slot_ids: string[] }> = {};
  for (const slot of slots) {
    const info = scheduleToBay[slot.bay_schedule_id];
    if (!info) continue;
    if (!slotsByBay[info.bay_id]) {
      slotsByBay[info.bay_id] = { date: info.date, slot_ids: [] };
    }
    slotsByBay[info.bay_id].slot_ids.push(slot.id);
  }

  // Create bookings (one per bay, matching existing confirm page behavior)
  const results: Array<{ confirmation_code: string; total_price: string; start_time: string; end_time: string }> = [];

  for (const [bayId, { date, slot_ids }] of Object.entries(slotsByBay)) {
    const { data, error } = await supabase.rpc("create_booking", {
      p_org_id: org.id,
      p_customer_id: customerId,
      p_bay_id: bayId,
      p_date: date,
      p_slot_ids: slot_ids,
      p_notes: args.notes || null,
    });

    if (error) {
      return { error: `Booking failed: ${error.message}` };
    }

    // The RPC returns a JSON object or array
    const bookings = Array.isArray(data) ? data : [data];
    for (const b of bookings) {
      results.push({
        confirmation_code: b.confirmation_code,
        total_price: `$${(b.total_price_cents / 100).toFixed(2)}`,
        start_time: formatTimeInZone(b.start_time, org.timezone),
        end_time: formatTimeInZone(b.end_time, org.timezone),
      });
    }
  }

  return {
    success: true,
    bookings: results,
    message: `Booking confirmed! Your confirmation ${results.length === 1 ? "code is" : "codes are"}: ${results.map((r) => r.confirmation_code).join(", ")}`,
  };
}

async function executeCancelBooking(
  org: OrgContext,
  customerId: string | null,
  args: { confirmation_code: string }
) {
  if (!customerId) {
    return { error: "You need to be signed in to cancel a booking. Please log in first." };
  }

  const supabase = await createClient();

  // Look up the booking by confirmation code
  const { data: booking } = await supabase
    .from("bookings")
    .select("id, customer_id, status, confirmation_code")
    .eq("org_id", org.id)
    .eq("confirmation_code", args.confirmation_code)
    .single();

  if (!booking) {
    return { error: `No booking found with confirmation code ${args.confirmation_code}.` };
  }

  if (booking.customer_id !== customerId) {
    return { error: "You can only cancel your own bookings." };
  }

  if (booking.status === "cancelled") {
    return { error: "This booking is already cancelled." };
  }

  const { error } = await supabase.rpc("cancel_booking", {
    p_booking_id: booking.id,
  });

  if (error) {
    return { error: `Cancellation failed: ${error.message}` };
  }

  return {
    success: true,
    message: `Booking ${args.confirmation_code} has been cancelled. The time slots are now available again.`,
  };
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

  // Check auth for booking tools
  const auth = await getAuthUser();
  const customerId = auth?.profile?.id ?? null;
  const customerName = auth?.profile?.full_name ?? null;

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

  const authStatus = customerId
    ? `The customer is signed in${customerName ? ` as ${customerName}` : ""}. They can book slots, view their bookings, and cancel bookings.`
    : "The customer is NOT signed in. They can browse availability but must sign in before booking, viewing bookings, or cancelling. Direct them to sign in at /auth/login if they want to perform these actions.";

  const systemInstruction = `You are a friendly and helpful booking assistant for ${org.name}. You help customers find available time slots, make bookings, manage their bookings, and answer questions about the facility.

Facility: ${org.name}
${org.description ? `Description: ${org.description}` : ""}
${org.address ? `Address: ${org.address}` : ""}
${org.phone ? `Phone: ${org.phone}` : ""}
Timezone: ${org.timezone}

Available bays:
${bayList}

Today's date is ${today}.
Customers can book up to 14 days ahead.

Authentication: ${authStatus}

Guidelines:
- Always use the get_available_slots tool to look up real-time availability. Never guess or make up availability.
- Use get_facility_info when the customer asks general questions about the facility or bays.
- Format times in 12-hour format (e.g., "9:00 AM").
- Format prices as dollars (e.g., "$45.00").
- Be concise and helpful. Use short paragraphs, not walls of text.
- If the customer asks about a date more than 14 days away, let them know you can only show the next 14 days.
- When listing available slots, organize them clearly by bay name and time.

Booking guidelines:
- BEFORE calling create_booking, you MUST summarize the booking details (bay, date, time, price) and ask the customer to confirm. Only call the tool after they explicitly agree.
- BEFORE calling cancel_booking, you MUST confirm the cancellation with the customer. Tell them which booking will be cancelled and that the action cannot be undone.
- When a booking is created, share the confirmation code with the customer.
- Use get_my_bookings to look up a customer's existing bookings when they ask.
- The slot_ids for create_booking come from the get_available_slots response. Always look up availability first.`;

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
        model: "gemini-2.5-flash",
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
          case "get_my_bookings":
            result = await executeGetMyBookings(
              org as OrgContext,
              customerId,
              call.args as { status_filter?: string }
            );
            break;
          case "create_booking":
            result = await executeCreateBooking(
              org as OrgContext,
              customerId,
              call.args as { slot_ids: string[]; notes?: string }
            );
            break;
          case "cancel_booking":
            result = await executeCancelBooking(
              org as OrgContext,
              customerId,
              call.args as { confirmation_code: string }
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
      { error: `Chat error: ${message}` },
      { status: 500 }
    );
  }
}
