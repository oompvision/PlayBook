import { GoogleGenAI, Type, type FunctionDeclaration, type Content, type Part } from "@google/genai";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { toTimestamp, getTodayInTimezone, formatTimeInZone } from "@/lib/utils";
import { getAuthUser } from "@/lib/auth";
import { createNotification, notifyOrgAdmins } from "@/lib/notifications";
import {
  getAvailableTimesForBay,
  getPooledAvailability,
  type DynamicScheduleRule,
  type ExistingBooking,
  type BlockOut,
  type BayInfo,
  type RateOverride,
} from "@/lib/availability-engine";

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
      "Get information about this facility including its bookable resources, types, and pricing. Call this when the customer asks general questions about the facility.",
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: "get_available_slots",
    description:
      "Look up available time slots for a specific date. Returns slots grouped by facility with times and prices. Always call this to answer availability questions — never guess. For dynamic scheduling facilities, you must also provide a duration in minutes.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        date: {
          type: Type.STRING,
          description: "The date to check in YYYY-MM-DD format.",
        },
        duration: {
          type: Type.NUMBER,
          description:
            "Booking duration in minutes (e.g. 60 for 1 hour, 90 for 1.5 hours). Required for dynamic scheduling facilities. Common options: 30, 60, 90, 120.",
        },
        bay_name: {
          type: Type.STRING,
          description:
            "Optional facility name filter. Only return slots for facilities whose name contains this string (case-insensitive).",
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
      "Get the current customer's bookings. Returns upcoming and recent bookings with confirmation codes, times, facility names, and status. Only works for authenticated users.",
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
      "Create a booking for the customer. For slot-based scheduling: provide EITHER slot_ids from a previous get_available_slots call OR the date, bay_name, and start_time. For dynamic scheduling: provide date, bay_name, start_time, and end_time (ISO timestamps from get_available_slots). IMPORTANT: Always confirm the booking details with the customer BEFORE calling this tool.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        slot_ids: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description:
            "Array of slot IDs to book (slot-based scheduling only). These come from a prior get_available_slots response.",
        },
        date: {
          type: Type.STRING,
          description:
            "The booking date in YYYY-MM-DD format.",
        },
        bay_name: {
          type: Type.STRING,
          description:
            'The facility name (e.g., "Facility 1").',
        },
        start_time: {
          type: Type.STRING,
          description:
            'The desired start time — either 12-hour format (e.g., "6:00 PM") for slot-based, or ISO timestamp for dynamic scheduling.',
        },
        end_time: {
          type: Type.STRING,
          description:
            "The end time as ISO timestamp (dynamic scheduling only). From the get_available_slots response.",
        },
        price_cents: {
          type: Type.NUMBER,
          description:
            "The price in cents (dynamic scheduling only). From the get_available_slots response.",
        },
        notes: {
          type: Type.STRING,
          description: "Optional notes from the customer about the booking.",
        },
      },
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
  {
    name: "get_events",
    description:
      "Get upcoming events at this facility. Returns event details including name, date/time, capacity, spots remaining, price, facilities used, and enrollment status. Call this when the customer asks about events, classes, clinics, or group activities.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        date: {
          type: Type.STRING,
          description:
            "Optional date filter in YYYY-MM-DD format. If provided, only returns events on that date. If omitted, returns all upcoming events.",
        },
      },
    },
  },
  {
    name: "register_for_event",
    description:
      "Register the customer for a free event. For paid events, direct the customer to the events section on the facility page to complete registration with payment. IMPORTANT: Always confirm with the customer before calling this tool.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        event_id: {
          type: Type.STRING,
          description: "The event ID to register for, from a prior get_events response.",
        },
      },
      required: ["event_id"],
    },
  },
  {
    name: "suggest_quick_replies",
    description:
      "Suggest clickable quick-reply buttons for the customer. Call this alongside your text response to give the customer easy tap-to-reply options. Use for confirmations, facility/time selection, and follow-up actions.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        options: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description:
            "Array of short button labels (2-4 options). Keep labels concise and actionable.",
        },
      },
      required: ["options"],
    },
  },
  {
    name: "start_checkout",
    description:
      "Open the booking checkout flow for the customer with specific time slots pre-selected. Use this INSTEAD of create_booking when the facility requires payment. This will open the booking wizard on the main page with the correct date, bay, and time slots already selected so the customer can enter payment details and confirm. Call this after the customer confirms they want to book the discussed time slots.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        date: {
          type: Type.STRING,
          description: "The booking date in YYYY-MM-DD format.",
        },
        bay_name: {
          type: Type.STRING,
          description: 'The facility name (e.g., "Bay 3").',
        },
        start_time: {
          type: Type.STRING,
          description:
            'The start time in 12-hour format (e.g., "3:00 PM").',
        },
        end_time: {
          type: Type.STRING,
          description:
            "The end time as ISO timestamp (dynamic scheduling only).",
        },
        duration: {
          type: Type.NUMBER,
          description:
            "Booking duration in minutes (dynamic scheduling only).",
        },
        price_cents: {
          type: Type.NUMBER,
          description:
            "The price in cents (dynamic scheduling only).",
        },
        slot_ids: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description:
            "Optional array of slot IDs from a prior get_available_slots response (slot-based only).",
        },
      },
      required: ["date", "bay_name", "start_time"],
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
  min_booking_lead_minutes: number;
  scheduling_type: string;
  bookable_window_days: number;
  effective_window_days: number;
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
  args: { date: string; duration?: number; bay_name?: string; resource_type?: string }
) {
  // Route to the appropriate handler based on scheduling type
  if (org.scheduling_type === "dynamic") {
    return executeAvailableSlotsDynamic(org, args);
  }
  return executeAvailableSlotsSlotBased(org, args);
}

async function executeAvailableSlotsSlotBased(
  org: OrgContext,
  args: { date: string; bay_name?: string; resource_type?: string }
) {
  const supabase = await createClient();

  // Validate date is within the bookable window (membership-aware)
  const today = getTodayInTimezone(org.timezone);
  const windowDays = org.effective_window_days;
  const maxDate = new Date(today + "T12:00:00");
  maxDate.setDate(maxDate.getDate() + windowDays);
  const maxDateStr = maxDate.toISOString().split("T")[0];

  if (args.date < today) {
    return { error: "That date is in the past.", slots: [] };
  }
  if (args.date > maxDateStr) {
    return {
      error: `We can only show availability up to ${windowDays} days ahead (through ${maxDateStr}).`,
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
    return { error: "No matching facilities found.", slots: [] };
  }

  // Further filter by bay_name if provided
  const filteredBays = args.bay_name
    ? bays.filter((b) =>
        b.name.toLowerCase().includes(args.bay_name!.toLowerCase())
      )
    : bays;

  if (filteredBays.length === 0) {
    return { error: `No facilities matching "${args.bay_name}" found.`, slots: [] };
  }

  // Compute timezone-aware day boundaries
  const nextDay = new Date(args.date + "T12:00:00");
  nextDay.setDate(nextDay.getDate() + 1);
  const nextDayStr = nextDay.toISOString().split("T")[0];

  const dayStart = toTimestamp(args.date, "00:00:00", org.timezone);
  const dayEnd = toTimestamp(nextDayStr, "00:00:00", org.timezone);

  // For today, exclude slots starting within the lead time window
  let effectiveStart = dayStart;
  if (args.date === today && org.min_booking_lead_minutes > 0) {
    const cutoff = new Date(Date.now() + org.min_booking_lead_minutes * 60_000);
    effectiveStart = cutoff.toISOString();
  }

  // Get all available slots for this date
  const { data: allSlots } = await supabase
    .from("bay_schedule_slots")
    .select("id, start_time, end_time, price_cents, status, bay_schedule_id")
    .eq("org_id", org.id)
    .eq("status", "available")
    .gte("start_time", effectiveStart)
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
      message: `No available slots on ${args.date} for the requested facilities.`,
      slots: [],
    };
  }

  return { date: args.date, availability: grouped };
}

async function executeAvailableSlotsDynamic(
  org: OrgContext,
  args: { date: string; duration?: number; bay_name?: string; resource_type?: string }
) {
  const supabase = await createClient();

  const today = getTodayInTimezone(org.timezone);
  const windowDays = org.effective_window_days;
  const maxDate = new Date(today + "T12:00:00");
  maxDate.setDate(maxDate.getDate() + windowDays);
  const maxDateStr = maxDate.toISOString().split("T")[0];

  if (args.date < today) {
    return { error: "That date is in the past.", slots: [] };
  }
  if (args.date > maxDateStr) {
    return {
      error: `We can only show availability up to ${windowDays} days ahead (through ${maxDateStr}).`,
      slots: [],
    };
  }

  // Get active bays
  let bayQuery = supabase
    .from("bays")
    .select("id, name, resource_type, hourly_rate_cents")
    .eq("org_id", org.id)
    .eq("is_active", true);

  if (args.resource_type) {
    bayQuery = bayQuery.ilike("resource_type", `%${args.resource_type}%`);
  }

  const { data: allBays } = await bayQuery.order("sort_order").order("created_at");

  if (!allBays || allBays.length === 0) {
    return { error: "No matching facilities found.", slots: [] };
  }

  // Filter by bay_name if provided
  const filteredBays = args.bay_name
    ? allBays.filter((b) =>
        b.name.toLowerCase().includes(args.bay_name!.toLowerCase())
      )
    : allBays;

  if (filteredBays.length === 0) {
    return { error: `No facilities matching "${args.bay_name}" found.`, slots: [] };
  }

  const bayIds = filteredBays.map((b) => b.id);
  const dayOfWeek = new Date(args.date + "T12:00:00").getDay();

  // Fetch rules, bookings, block-outs, rate overrides in parallel
  const [rulesResult, bookingsResult, blockOutsResult, rateOverridesResult] =
    await Promise.all([
      supabase
        .from("dynamic_schedule_rules")
        .select("*")
        .in("bay_id", bayIds)
        .eq("day_of_week", dayOfWeek),
      supabase
        .from("bookings")
        .select("bay_id, start_time, end_time")
        .in("bay_id", bayIds)
        .eq("date", args.date)
        .eq("status", "confirmed"),
      supabase
        .from("schedule_block_outs")
        .select("bay_id, start_time, end_time")
        .in("bay_id", bayIds)
        .eq("date", args.date),
      supabase
        .from("dynamic_rate_overrides")
        .select("bay_id, date, start_time, end_time, hourly_rate_cents")
        .in("bay_id", bayIds)
        .eq("date", args.date),
    ]);

  const rules = (rulesResult.data || []) as DynamicScheduleRule[];
  const bookings = bookingsResult.data || [];
  const blockOuts = blockOutsResult.data || [];
  const rateOverrides = (rateOverridesResult.data || []) as RateOverride[];

  // Determine duration — use provided or default from first rule
  const availableDurations = rules.length > 0 ? rules[0].available_durations : [60];
  let duration = args.duration || availableDurations[0] || 60;

  // Validate duration is in the allowed list
  if (!availableDurations.includes(duration)) {
    // Pick the closest allowed duration
    duration = availableDurations.reduce((prev, curr) =>
      Math.abs(curr - duration) < Math.abs(prev - duration) ? curr : prev
    );
  }

  // Build maps
  const baysData: BayInfo[] = filteredBays.map((b) => ({
    id: b.id,
    name: b.name,
    hourly_rate_cents: b.hourly_rate_cents,
  }));

  const rulesMap = new Map<string, DynamicScheduleRule>();
  for (const r of rules) rulesMap.set(r.bay_id, r);

  const bookingsMap = new Map<string, ExistingBooking[]>();
  for (const b of bookings) {
    const list = bookingsMap.get(b.bay_id) || [];
    list.push({ start_time: b.start_time, end_time: b.end_time });
    bookingsMap.set(b.bay_id, list);
  }

  const blockOutsMap = new Map<string, BlockOut[]>();
  for (const bo of blockOuts) {
    const list = blockOutsMap.get(bo.bay_id) || [];
    list.push({ start_time: bo.start_time, end_time: bo.end_time });
    blockOutsMap.set(bo.bay_id, list);
  }

  // Get pooled availability (deduped across bays)
  const slots = baysData.length > 1
    ? getPooledAvailability({
        bays: baysData,
        rulesMap,
        date: args.date,
        duration,
        timezone: org.timezone,
        bookingsMap,
        blockOutsMap,
        minBookingLeadMinutes: org.min_booking_lead_minutes ?? 0,
        rateOverrides,
      })
    : baysData.length === 1 && rulesMap.has(baysData[0].id)
    ? getAvailableTimesForBay({
        bay: baysData[0],
        rule: rulesMap.get(baysData[0].id)!,
        date: args.date,
        duration,
        timezone: org.timezone,
        existingBookings: bookingsMap.get(baysData[0].id) || [],
        blockOuts: blockOutsMap.get(baysData[0].id) || [],
        minBookingLeadMinutes: org.min_booking_lead_minutes ?? 0,
        rateOverrides,
      })
    : [];

  if (slots.length === 0) {
    return {
      message: `No available times on ${args.date} for a ${duration}-minute booking.`,
      slots: [],
      available_durations: availableDurations,
    };
  }

  // Format for Gemini — include ISO timestamps for create_booking
  const formatted = slots.map((s) => ({
    time: `${formatTimeInZone(s.start_time, org.timezone)} - ${formatTimeInZone(s.end_time, org.timezone)}`,
    price: `$${(s.price_cents / 100).toFixed(2)}`,
    price_cents: s.price_cents,
    start_time: s.start_time,
    end_time: s.end_time,
    bay_name: s.bay_name,
  }));

  // Group by bay for display
  const grouped: Record<string, typeof formatted> = {};
  for (const s of formatted) {
    if (!grouped[s.bay_name]) grouped[s.bay_name] = [];
    grouped[s.bay_name].push(s);
  }

  return {
    date: args.date,
    duration_minutes: duration,
    available_durations: availableDurations,
    availability: grouped,
  };
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
  args: {
    slot_ids?: string[] | string;
    date?: string;
    bay_name?: string;
    start_time?: string;
    end_time?: string;
    price_cents?: number;
    notes?: string;
  },
  paymentContext: { requiresPayment: boolean; paymentMode: string; cancellationPolicyText: string | null }
) {
  if (!customerId) {
    return { error: "You need to be signed in to make a booking. Please log in first." };
  }

  // Safety net: if payment is required, block create_booking (Gemini should use start_checkout instead)
  if (paymentContext.requiresPayment) {
    return {
      requires_payment: true,
      message: "This facility requires payment. Use the start_checkout tool instead to open the booking form with payment entry for the customer.",
    };
  }

  // Route to the appropriate handler based on scheduling type
  if (org.scheduling_type === "dynamic") {
    return executeCreateBookingDynamic(org, customerId, args, paymentContext);
  }
  return executeCreateBookingSlotBased(org, customerId, args, paymentContext);
}

async function executeCreateBookingDynamic(
  org: OrgContext,
  customerId: string,
  args: {
    date?: string;
    bay_name?: string;
    start_time?: string;
    end_time?: string;
    price_cents?: number;
    notes?: string;
  },
  paymentContext: { cancellationPolicyText: string | null }
) {
  if (!args.date || !args.bay_name || !args.start_time || !args.end_time) {
    return {
      error: "For dynamic scheduling, provide date, bay_name, start_time (ISO timestamp), and end_time (ISO timestamp) from the get_available_slots response.",
    };
  }

  const supabase = await createClient();

  // Find the bay by name
  const { data: bays } = await supabase
    .from("bays")
    .select("id, name")
    .eq("org_id", org.id)
    .eq("is_active", true);

  const matchedBay = bays?.find((b) =>
    b.name.toLowerCase().includes(args.bay_name!.toLowerCase())
  );

  if (!matchedBay) {
    return { error: `No facility matching "${args.bay_name}" found.` };
  }

  // Check if this bay is in a facility group (for consolidation)
  const { data: membership } = await supabase
    .from("facility_group_members")
    .select("group_id")
    .eq("bay_id", matchedBay.id)
    .single();

  const priceCents = args.price_cents || 0;

  // Use the dynamic booking RPC
  const { data, error } = await supabase.rpc("create_dynamic_booking", {
    p_org_id: org.id,
    p_customer_id: customerId,
    p_bay_id: matchedBay.id,
    p_date: args.date,
    p_start_time: args.start_time,
    p_end_time: args.end_time,
    p_price_cents: priceCents,
    p_notes: args.notes || null,
  });

  if (error) {
    return { error: `Booking failed: ${error.message}` };
  }

  const confirmationCode = data?.confirmation_code || "Unknown";
  const totalPrice = `$${(priceCents / 100).toFixed(2)}`;
  const startFormatted = formatTimeInZone(args.start_time, org.timezone);
  const endFormatted = formatTimeInZone(args.end_time, org.timezone);

  // Fire booking notifications (non-blocking)
  const chatDateStr = new Date(args.date + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric",
  });
  const chatTimeStr = `${startFormatted} – ${endFormatted}`;
  const chatMeta = {
    confirmation_code: confirmationCode,
    bay: matchedBay.name,
    dateStr: chatDateStr,
    timeStr: chatTimeStr,
    totalPrice,
  };

  createNotification({
    orgId: org.id,
    recipientId: customerId,
    recipientType: "customer",
    type: "booking_confirmed",
    title: "Booking Confirmed",
    message: `${chatTimeStr}, ${confirmationCode}. Total: ${totalPrice}`,
    link: `/my-bookings?booking=${confirmationCode}`,
    orgName: org.name,
    metadata: chatMeta,
  }).catch(() => {});

  notifyOrgAdmins(org.id, org.name, {
    type: "booking_confirmed",
    title: `New Booking: ${confirmationCode}`,
    message: `Chat booking: ${chatTimeStr} (${totalPrice})`,
    link: `/admin/bookings?booking=${confirmationCode}`,
    metadata: chatMeta,
  }).catch(() => {});

  return {
    success: true,
    bookings: [
      {
        confirmation_code: confirmationCode,
        total_price: totalPrice,
        start_time: startFormatted,
        end_time: endFormatted,
        bay_name: matchedBay.name,
      },
    ],
    message: `Booking confirmed! Your confirmation code is: ${confirmationCode}`,
    policy_notice: paymentContext.cancellationPolicyText || null,
  };
}

async function executeCreateBookingSlotBased(
  org: OrgContext,
  customerId: string,
  args: {
    slot_ids?: string[] | string;
    date?: string;
    bay_name?: string;
    start_time?: string;
    notes?: string;
  },
  paymentContext: { cancellationPolicyText: string | null }
) {
  const supabase = await createClient();

  // Normalize slot_ids — Gemini may pass a single string instead of an array
  let slotIds: string[] = Array.isArray(args.slot_ids)
    ? args.slot_ids
    : args.slot_ids
      ? [args.slot_ids]
      : [];

  // Try to look up slots by ID first, verifying they are still available
  let slots: { id: string; bay_schedule_id: string }[] | null = null;
  if (slotIds.length > 0) {
    const { data } = await supabase
      .from("bay_schedule_slots")
      .select("id, bay_schedule_id, status")
      .in("id", slotIds)
      .eq("org_id", org.id);

    const unavailable = data?.filter((s) => s.status !== "available") || [];
    if (unavailable.length > 0) {
      return { error: "One or more of those time slots are no longer available. Please check availability again for updated options." };
    }

    slots = data;
  }

  // Fallback: resolve slots from date + bay_name + start_time
  if ((!slots || slots.length === 0) && args.date && args.bay_name && args.start_time) {
    const { data: bays } = await supabase
      .from("bays")
      .select("id, name")
      .eq("org_id", org.id)
      .eq("is_active", true);

    const matchedBay = bays?.find((b) =>
      b.name.toLowerCase().includes(args.bay_name!.toLowerCase())
    );

    if (!matchedBay) {
      return { error: `No facility matching "${args.bay_name}" found.` };
    }

    // Get the bay_schedule for this date
    const { data: schedules } = await supabase
      .from("bay_schedules")
      .select("id")
      .eq("bay_id", matchedBay.id)
      .eq("org_id", org.id)
      .eq("date", args.date);

    if (!schedules || schedules.length === 0) {
      return { error: `No schedule found for ${matchedBay.name} on ${args.date}.` };
    }

    const scheduleIds = schedules.map((s) => s.id);

    // Get available slots for this bay/date
    const { data: availableSlots } = await supabase
      .from("bay_schedule_slots")
      .select("id, start_time, bay_schedule_id")
      .in("bay_schedule_id", scheduleIds)
      .eq("org_id", org.id)
      .eq("status", "available")
      .order("start_time");

    if (!availableSlots || availableSlots.length === 0) {
      return { error: `No available slots for ${matchedBay.name} on ${args.date}.` };
    }

    // Match by formatted start_time
    const requestedTime = args.start_time.toLowerCase().replace(/\s+/g, " ").trim();
    const matched = availableSlots.filter((s) => {
      const formatted = formatTimeInZone(s.start_time, org.timezone)
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
      return formatted === requestedTime;
    });

    if (matched.length === 0) {
      return {
        error: `No available slot at ${args.start_time} for ${matchedBay.name} on ${args.date}. Available times: ${availableSlots.map((s) => formatTimeInZone(s.start_time, org.timezone)).join(", ")}`,
      };
    }

    slots = matched;
    slotIds = matched.map((s) => s.id);
  }

  if (!slots || slots.length === 0) {
    return { error: "No slots identified. Please provide either slot_ids or date + bay_name + start_time." };
  }

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

  // Create bookings — the RPC handles availability checks with row locking
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

  // Fire booking notifications (non-blocking, server-side)
  const slotDateStr = new Date(args.date + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric",
  });
  for (const b of results) {
    const code = b.confirmation_code as string;
    const slotTimeStr = `${b.start_time} – ${b.end_time}`;
    const slotMeta = {
      confirmation_code: code,
      bay: args.bay_name || "Facility",
      dateStr: slotDateStr,
      timeStr: slotTimeStr,
      totalPrice: b.total_price,
    };

    createNotification({
      orgId: org.id,
      recipientId: customerId,
      recipientType: "customer",
      type: "booking_confirmed",
      title: "Booking Confirmed",
      message: `${slotTimeStr}, ${code}. Total: ${b.total_price}`,
      link: `/my-bookings?booking=${code}`,
      orgName: org.name,
      metadata: slotMeta,
    }).catch(() => {});

    notifyOrgAdmins(org.id, org.name, {
      type: "booking_confirmed",
      title: `New Booking: ${code}`,
      message: `Chat booking: ${slotTimeStr} (${b.total_price})`,
      link: `/admin/bookings?booking=${code}`,
      metadata: slotMeta,
    }).catch(() => {});
  }

  return {
    success: true,
    bookings: results,
    message: `Booking confirmed! Your confirmation ${results.length === 1 ? "code is" : "codes are"}: ${results.map((r) => r.confirmation_code).join(", ")}`,
    policy_notice: paymentContext.cancellationPolicyText || null,
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

  // Fire cancellation notifications (non-blocking)
  const cancelMeta = { confirmation_code: args.confirmation_code };

  createNotification({
    orgId: org.id,
    recipientId: customerId,
    recipientType: "customer",
    type: "booking_canceled",
    title: "Booking Cancelled",
    message: `Your booking ${args.confirmation_code} has been cancelled.`,
    link: `/my-bookings?booking=${args.confirmation_code}`,
    orgName: org.name,
    metadata: cancelMeta,
  }).catch(() => {});

  notifyOrgAdmins(org.id, org.name, {
    type: "booking_canceled",
    title: `Booking Cancelled: ${args.confirmation_code}`,
    message: `Chat cancellation: ${args.confirmation_code}`,
    link: `/admin/bookings?booking=${args.confirmation_code}`,
    metadata: cancelMeta,
  }).catch(() => {});

  return {
    success: true,
    message: `Booking ${args.confirmation_code} has been cancelled. The time slots are now available again.`,
  };
}

// ---------------------------------------------------------------------------
// Event tools
// ---------------------------------------------------------------------------

type EventDiscountInfo = {
  isMember: boolean;
  eventDiscountType: string | null;
  eventDiscountValue: number;
};

async function executeGetEvents(
  org: OrgContext,
  args: { date?: string },
  customerId: string | null,
  discountInfo: EventDiscountInfo
) {
  const supabase = await createClient();
  const svc = createServiceClient();

  const now = new Date().toISOString();

  // Fetch published events
  let query = supabase
    .from("events")
    .select(
      "id, name, description, start_time, end_time, capacity, price_cents, members_only, member_enrollment_days_before, guest_enrollment_days_before, event_bays(bay_id, bays:bay_id(name))"
    )
    .eq("org_id", org.id)
    .eq("status", "published")
    .gte("end_time", now)
    .order("start_time", { ascending: true });

  // If date filter provided, scope to that day
  if (args.date) {
    const dayStart = toTimestamp(args.date, "00:00:00", org.timezone);
    const nextDay = new Date(args.date + "T12:00:00Z");
    nextDay.setDate(nextDay.getDate() + 1);
    const dayEnd = toTimestamp(nextDay.toISOString().split("T")[0], "00:00:00", org.timezone);
    query = query.lt("start_time", dayEnd).gte("start_time", dayStart);
  }

  const { data: events } = await query;

  if (!events || events.length === 0) {
    return { events: [], message: args.date ? `No upcoming events on ${args.date}.` : "No upcoming events at this time." };
  }

  // Get registration counts for each event
  const countMap: Record<string, number> = {};
  for (const evt of events) {
    const { data: count } = await svc.rpc("get_event_registration_count", { p_event_id: evt.id });
    countMap[evt.id] = count ?? 0;
  }

  // Check user's registrations if authenticated
  let userRegistrations: Record<string, string> = {};
  if (customerId) {
    const { data: regs } = await supabase
      .from("event_registrations")
      .select("event_id, status")
      .eq("user_id", (await getAuthUser())?.user?.id ?? "")
      .in("event_id", events.map((e) => e.id))
      .in("status", ["confirmed", "waitlisted", "pending_payment"]);

    if (regs) {
      for (const r of regs) {
        userRegistrations[r.event_id] = r.status;
      }
    }
  }

  const today = getTodayInTimezone(org.timezone);

  const result = events.map((evt) => {
    const registered = countMap[evt.id] || 0;
    const spotsLeft = evt.capacity - registered;
    const eventBays = evt.event_bays as unknown as { bay_id: string; bays: { name: string } | null }[];
    const bays = (eventBays || [])
      .map((eb) => eb.bays?.name)
      .filter(Boolean);

    // Calculate enrollment window
    const eventDate = new Date(evt.start_time);
    const todayDate = new Date(today + "T12:00:00Z");
    const daysUntil = Math.ceil((eventDate.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24));

    const enrollmentDays = discountInfo.isMember
      ? (evt.member_enrollment_days_before ?? 9999)
      : evt.guest_enrollment_days_before;
    const enrollmentOpen = daysUntil <= enrollmentDays;

    let enrollmentOpensOn: string | null = null;
    if (!enrollmentOpen) {
      const openDate = new Date(eventDate);
      openDate.setDate(openDate.getDate() - enrollmentDays);
      enrollmentOpensOn = openDate.toISOString().split("T")[0];
    }

    // Calculate member pricing
    let memberPriceCents: number | null = null;
    if (
      discountInfo.eventDiscountType &&
      discountInfo.eventDiscountValue > 0 &&
      evt.price_cents > 0
    ) {
      if (discountInfo.eventDiscountType === "percent") {
        memberPriceCents = Math.round(
          evt.price_cents * (1 - discountInfo.eventDiscountValue / 100)
        );
      } else {
        memberPriceCents = Math.max(
          0,
          evt.price_cents - Math.round(discountInfo.eventDiscountValue * 100)
        );
      }
    }

    const eventInfo: Record<string, unknown> = {
      event_id: evt.id,
      name: evt.name,
      description: evt.description,
      date: new Date(evt.start_time).toLocaleDateString("en-US", {
        timeZone: org.timezone,
        weekday: "short",
        month: "short",
        day: "numeric",
      }),
      start_time: formatTimeInZone(evt.start_time, org.timezone),
      end_time: formatTimeInZone(evt.end_time, org.timezone),
      facilities: bays,
      capacity: evt.capacity,
      registered: registered,
      spots_left: spotsLeft,
      price: evt.price_cents === 0 ? "Free" : `$${(evt.price_cents / 100).toFixed(2)}`,
      price_cents: evt.price_cents,
      members_only: evt.members_only,
      enrollment_open: enrollmentOpen,
    };

    if (memberPriceCents !== null) {
      eventInfo.member_price = `$${(memberPriceCents / 100).toFixed(2)}`;
      eventInfo.member_price_cents = memberPriceCents;
    }

    if (!enrollmentOpen && enrollmentOpensOn) {
      eventInfo.enrollment_opens_on = enrollmentOpensOn;
    }

    if (customerId && userRegistrations[evt.id]) {
      eventInfo.your_registration_status = userRegistrations[evt.id];
    }

    return eventInfo;
  });

  return { events: result };
}

async function executeRegisterForEvent(
  org: OrgContext,
  args: { event_id: string },
  customerId: string | null,
  discountInfo: EventDiscountInfo
) {
  if (!customerId) {
    return {
      error:
        "You need to be signed in to register for events. Please sign in at /auth/login first.",
    };
  }

  const supabase = await createClient();
  const auth = await getAuthUser();
  const userId = auth?.user?.id;
  if (!userId) {
    return { error: "Authentication error. Please sign in again." };
  }

  // Fetch the event
  const { data: evt } = await supabase
    .from("events")
    .select("id, name, start_time, end_time, price_cents, members_only, member_enrollment_days_before, guest_enrollment_days_before, status")
    .eq("id", args.event_id)
    .eq("org_id", org.id)
    .single();

  if (!evt) {
    return { error: "Event not found." };
  }

  if (evt.status !== "published") {
    return { error: "This event is not currently available for registration." };
  }

  // Check members-only
  if (evt.members_only && !discountInfo.isMember) {
    return {
      error: "This event is for members only. Check out the membership at /membership to join!",
    };
  }

  // Check enrollment window
  const today = getTodayInTimezone(org.timezone);
  const eventDate = new Date(evt.start_time);
  const todayDate = new Date(today + "T12:00:00Z");
  const daysUntil = Math.ceil(
    (eventDate.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  const enrollmentDays = discountInfo.isMember
    ? (evt.member_enrollment_days_before ?? 9999)
    : evt.guest_enrollment_days_before;

  if (daysUntil > enrollmentDays) {
    const openDate = new Date(eventDate);
    openDate.setDate(openDate.getDate() - enrollmentDays);
    const openDateStr = openDate.toISOString().split("T")[0];
    return {
      error: `Registration for this event isn't open yet. It opens on ${openDateStr}.`,
    };
  }

  // Check if paid event — direct to UI
  if (evt.price_cents > 0) {
    return {
      requires_payment: true,
      message:
        "This is a paid event. Please register through the events section on our facility page where you can complete payment.",
    };
  }

  // Register for free event via RPC
  const svc = createServiceClient();
  const { data: result, error } = await svc.rpc("register_for_event", {
    p_event_id: args.event_id,
    p_user_id: userId,
  });

  if (error) {
    return { error: `Registration failed: ${error.message}` };
  }

  const reg = result as { registration_id: string; status: string; waitlist_position: number | null; event_name: string };

  if (reg.status === "confirmed") {
    return {
      success: true,
      message: `You're registered for "${reg.event_name}"! See you there.`,
      status: "confirmed",
    };
  } else if (reg.status === "waitlisted") {
    return {
      success: true,
      message: `The event is currently full. You've been added to the waitlist at position ${reg.waitlist_position}. We'll notify you if a spot opens up!`,
      status: "waitlisted",
      waitlist_position: reg.waitlist_position,
    };
  }

  return { success: true, status: reg.status };
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
    .select("id, name, slug, timezone, description, address, phone, min_booking_lead_minutes, scheduling_type, bookable_window_days, membership_tiers_enabled, events_enabled")
    .eq("slug", facilitySlug)
    .single();

  if (!org) {
    return Response.json({ error: "Facility not found" }, { status: 404 });
  }

  // Check auth for booking tools
  const auth = await getAuthUser();
  const customerId = auth?.profile?.id ?? null;
  const customerName = auth?.profile?.full_name ?? null;

  // Resolve membership-aware bookable window + tier context
  let effectiveWindowDays = org.bookable_window_days || 30;
  let membershipInfo: {
    enabled: boolean;
    isMember: boolean;
    tierName: string | null;
    discountType: string | null;
    discountValue: number;
    eventDiscountType: string | null;
    eventDiscountValue: number;
    guestWindowDays: number;
    memberWindowDays: number;
  } = { enabled: false, isMember: false, tierName: null, discountType: null, discountValue: 0, eventDiscountType: null, eventDiscountValue: 0, guestWindowDays: effectiveWindowDays, memberWindowDays: effectiveWindowDays };

  if (org.membership_tiers_enabled) {
    const svc = createServiceClient();

    const [windowResult, orgWindowResult, tierResult, membershipResult] = await Promise.all([
      svc.rpc("get_effective_bookable_window", { p_org_id: org.id, p_user_id: auth?.user?.id ?? null }),
      svc.from("organizations").select("guest_booking_window_days, member_booking_window_days").eq("id", org.id).single(),
      svc.from("membership_tiers").select("name, discount_type, discount_value, event_discount_type, event_discount_value").eq("org_id", org.id).single(),
      auth ? svc.rpc("is_active_member", { p_org_id: org.id, p_user_id: auth.user.id }) : Promise.resolve({ data: false }),
    ]);

    if (windowResult.data != null) {
      effectiveWindowDays = windowResult.data;
    }

    const guestWindow = orgWindowResult.data?.guest_booking_window_days ?? org.bookable_window_days ?? 30;
    const memberWindow = orgWindowResult.data?.member_booking_window_days ?? guestWindow;

    membershipInfo = {
      enabled: true,
      isMember: !!membershipResult.data,
      tierName: tierResult.data?.name ?? null,
      discountType: tierResult.data?.discount_type ?? null,
      discountValue: tierResult.data?.discount_value ? Number(tierResult.data.discount_value) : 0,
      eventDiscountType: tierResult.data?.event_discount_type ?? null,
      eventDiscountValue: tierResult.data?.event_discount_value ? Number(tierResult.data.event_discount_value) : 0,
      guestWindowDays: guestWindow,
      memberWindowDays: memberWindow,
    };
  }

  // Attach effective window to org context
  const orgContext: OrgContext = { ...org, effective_window_days: effectiveWindowDays };

  // Fetch payment settings for this org
  const service = createServiceClient();
  const { data: paymentSettings } = await service
    .from("org_payment_settings")
    .select("payment_mode, stripe_onboarding_complete, cancellation_policy_text")
    .eq("org_id", org.id)
    .single();

  const paymentMode = paymentSettings?.payment_mode ?? "none";
  const stripeReady = paymentSettings?.stripe_onboarding_complete ?? false;
  const requiresPayment = paymentMode !== "none" && stripeReady;
  const cancellationPolicyText = paymentSettings?.cancellation_policy_text ?? null;
  const paymentContext = { requiresPayment, paymentMode, cancellationPolicyText };

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
      : "No facilities configured yet.";

  const today = getTodayInTimezone(orgContext.timezone);
  const isDynamic = (orgContext.scheduling_type ?? "slot_based") === "dynamic";
  const windowDays = effectiveWindowDays;

  // Fetch facility groups + durations for dynamic scheduling
  let facilityGroupInfo = "";
  let durationInfo = "";
  if (isDynamic && bays && bays.length > 0) {
    const bayIds = bays.map(() => ""); // We need the bay IDs, but bayList only has names
    // Fetch groups and rules
    const [groupsResult, membersResult, rulesResult] = await Promise.all([
      supabase
        .from("facility_groups")
        .select("id, name, description")
        .eq("org_id", org.id),
      supabase
        .from("facility_group_members")
        .select("group_id, bay_id"),
      supabase
        .from("dynamic_schedule_rules")
        .select("available_durations")
        .eq("org_id", org.id)
        .limit(1),
    ]);

    const groups = groupsResult.data || [];
    const members = membersResult.data || [];
    const durations = rulesResult.data?.[0]?.available_durations || [60];

    if (groups.length > 0) {
      const groupDescs = groups.map((g) => {
        const memberCount = members.filter((m) => m.group_id === g.id).length;
        return `- ${g.name}${g.description ? ` (${g.description})` : ""} — ${memberCount} facilities`;
      }).join("\n");
      facilityGroupInfo = `\nFacility groups (interchangeable bays — the system picks the best one automatically):\n${groupDescs}\n`;
    }

    durationInfo = `Available booking durations: ${durations.map((d: number) => {
      if (d < 60) return `${d} min`;
      if (d % 60 === 0) return `${d / 60} hour${d > 60 ? "s" : ""}`;
      return `${Math.floor(d / 60)}h ${d % 60}m`;
    }).join(", ")}`;
  }

  const authStatus = customerId
    ? `The customer is signed in${customerName ? ` as ${customerName}` : ""}. They can book slots, view their bookings, and cancel bookings.`
    : "The customer is NOT signed in. They can browse availability but must sign in before booking, viewing bookings, or cancelling. Direct them to sign in at /auth/login if they want to perform these actions.";

  // Build membership prompt section
  let membershipPrompt = "";
  if (membershipInfo.enabled) {
    const discountDesc = membershipInfo.discountType === "percent"
      ? `${membershipInfo.discountValue}% off every booking`
      : membershipInfo.discountValue > 0
        ? `$${membershipInfo.discountValue.toFixed(2)} off every booking`
        : null;

    const eventDiscountDesc = membershipInfo.eventDiscountType === "percent"
      ? membershipInfo.eventDiscountValue > 0 ? `${membershipInfo.eventDiscountValue}% off event registration` : null
      : membershipInfo.eventDiscountValue > 0
        ? `$${membershipInfo.eventDiscountValue.toFixed(2)} off event registration`
        : null;

    if (membershipInfo.isMember) {
      membershipPrompt = `
Membership:
- This customer is an ACTIVE MEMBER${membershipInfo.tierName ? ` (${membershipInfo.tierName})` : ""}.
- They can book up to ${membershipInfo.memberWindowDays} days ahead (guests can only book ${membershipInfo.guestWindowDays} days ahead).
${discountDesc ? `- Their member discount (${discountDesc}) is applied automatically at checkout — you do NOT need to calculate discounted prices. Show the standard listed price when discussing availability.` : ""}
${eventDiscountDesc ? `- They also get ${eventDiscountDesc}. When showing event pricing, show both the regular price and their discounted member price.` : ""}
- When confirming bookings, you can mention they're getting their member benefits.`;
    } else {
      membershipPrompt = `
Membership:
- This facility offers a membership program${membershipInfo.tierName ? ` called "${membershipInfo.tierName}"` : ""}.
- This customer is NOT a member (guest).
- Guests can book up to ${membershipInfo.guestWindowDays} days ahead. Members can book up to ${membershipInfo.memberWindowDays} days ahead.
${discountDesc ? `- Members get ${discountDesc}.` : ""}
${eventDiscountDesc ? `- Members also get ${eventDiscountDesc}.` : ""}
- If the customer asks about a date beyond ${membershipInfo.guestWindowDays} days, let them know that members can book further in advance and suggest they check out the membership at /membership.
- Do NOT aggressively upsell. Only mention membership benefits naturally when relevant (e.g., when they hit the booking window limit, or if they ask about pricing/discounts/membership).`;
    }
  }

  const schedulingTypeInfo = isDynamic
    ? `Scheduling type: DYNAMIC — customers choose a date, duration, and start time. Availability is computed in real-time from operating hours, existing bookings, and block-outs. When checking availability, you MUST include a duration parameter (in minutes).
${facilityGroupInfo}${durationInfo ? `${durationInfo}\n` : ""}
When making a booking, pass date, bay_name, start_time (ISO timestamp), end_time (ISO timestamp), and price_cents — all available in the get_available_slots response.`
    : `Scheduling type: SLOT-BASED — admins publish fixed time slots. Customers pick from pre-defined slots.
When making a booking, provide slot_ids from get_available_slots, or date + bay_name + start_time (12-hour format).`;

  const systemInstruction = `You are a friendly and helpful booking assistant for ${org.name}. You help customers find available time slots, make bookings, manage their bookings, and answer questions about the facility.

Facility: ${org.name}
${org.description ? `Description: ${org.description}` : ""}
${org.address ? `Address: ${org.address}` : ""}
${org.phone ? `Phone: ${org.phone}` : ""}
Timezone: ${org.timezone}

Available facilities:
${bayList}

${schedulingTypeInfo}

Today's date is ${today}.
Customers can book up to ${windowDays} days ahead.

Authentication: ${authStatus}
${membershipPrompt}

Guidelines:
- Always use the get_available_slots tool to look up real-time availability. Never guess or make up availability.${isDynamic ? "\n- For get_available_slots, ALWAYS include a duration parameter. If the customer doesn't specify a duration, ask them or default to the first available duration option." : ""}
- Use get_facility_info when the customer asks general questions about the facility or its offerings.
- Format times in 12-hour format (e.g., "9:00 AM").
- Format prices as dollars (e.g., "$45.00").
- Be concise and helpful. Use short paragraphs, not walls of text.
- If the customer asks about a date more than ${windowDays} days away, let them know the booking window.
- When listing available slots, organize them clearly by facility name and time.${isDynamic ? "\n- When showing dynamic availability, mention the duration being shown and that other durations are available if the customer wants to change it." : ""}

Booking guidelines:
- BEFORE calling create_booking, you MUST summarize the booking details (facility, date, time, price) and ask the customer to confirm. Only call the tool after they explicitly agree.
- BEFORE calling cancel_booking, you MUST confirm the cancellation with the customer. Tell them which booking will be cancelled and that the action cannot be undone.
- When a booking is created, share the confirmation code with the customer.
- Use get_my_bookings to look up a customer's existing bookings when they ask.
${isDynamic ? `- For create_booking (dynamic): pass date, bay_name, start_time (ISO timestamp), end_time (ISO timestamp), and price_cents — all from the get_available_slots response. Do NOT use slot_ids for dynamic scheduling.` : `- For create_booking, you can provide EITHER slot_ids (from get_available_slots) OR date + bay_name + start_time. When confirming a booking the customer already discussed, prefer passing date, bay_name, and start_time directly — this is simpler and more reliable.`}
${requiresPayment ? `
Payment policy:
- This facility requires payment to complete a booking (mode: ${paymentMode}).
- You CANNOT complete bookings directly in chat. Do NOT use create_booking — it will not work.
- Instead, use the start_checkout tool to open the booking form with the correct slots pre-selected.
- Flow: help the customer find the right time slots → confirm the details (date, bay, time, price) → when they agree, call start_checkout with the date, bay_name, and start_time${isDynamic ? ", end_time, duration, and price_cents" : ""}. This will automatically open the booking form for them with payment entry.
- After calling start_checkout, tell the customer something like "I've opened the booking form for you — just add your payment details and confirm!"
` : `
Payment policy:
- This facility does not require payment at booking time. You can complete bookings directly in chat using create_booking.
- When confirming a booking, include this notice: "By confirming, you agree to the facility's terms and cancellation policy."${cancellationPolicyText ? `\n- Cancellation policy: ${cancellationPolicyText}` : ""}
- Do NOT use start_checkout when no payment is required — use create_booking instead.
`}
${(org.events_enabled ?? true) ? `Event guidelines:
- Use get_events when the customer asks about events, classes, clinics, or group activities.
- When showing events, include: name, date, time, price, spots remaining, and which facilities are used.
- For members, show both the regular price and their discounted member price.
- If enrollment isn't open yet, tell the customer when registration opens.
- For free events, you can register the customer directly using register_for_event (after confirming with them).
- For paid events, direct the customer to the events section on the facility page to register and pay.
- BEFORE calling register_for_event, summarize the event and confirm that the customer wants to register.
- Members-only events: if the customer is not a member, let them know the event is members-only and suggest checking out the membership at /membership.
` : `This facility does not have events enabled. If the customer asks about events, let them know this facility doesn't currently offer events.
`}
Quick reply buttons:
- ALWAYS call suggest_quick_replies to offer clickable buttons when the customer needs to make a choice.
- When to use quick replies:
  - After showing availability → offer facility names or times to pick from.${isDynamic ? "\n  - When asking about duration → offer available duration options (e.g., \"30 min\", \"1 hour\", \"90 min\")." : ""}
  - When asking for booking confirmation → "Confirm booking" and "No, cancel".
  - When asking for cancellation confirmation → "Yes, cancel it" and "No, keep it".
  - After a successful booking → "Show my bookings" and "Book another slot".
  - After cancellation → "Show my bookings" and "Check availability".
  - When asking a yes/no question → "Yes" and "No".
- Keep labels short (2-5 words) and limit to 2-4 options.`;

  // Convert messages to Gemini Content format
  const currentMessages: Content[] = messages.map((m) => ({
    role: m.role === "model" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  // Resolve tool calls server-side in a loop, then stream the final text response
  try {
    let finalText = "";
    let quickReplies: string[] = [];
    let bookingAction: { date: string; bay_name: string; start_time: string; end_time?: string; duration?: number; price_cents?: number; slot_ids?: string[] } | null = null;

    // Filter out event tools if events are disabled for this org
    const eventToolNames = new Set(["get_events", "register_for_event"]);
    const activeToolDeclarations = (org.events_enabled ?? true)
      ? toolDeclarations
      : toolDeclarations.filter((t) => !eventToolNames.has(t.name!));

    // Tool call loop — up to 5 rounds to prevent infinite loops
    for (let i = 0; i < 5; i++) {
      const response = await getGenAI().models.generateContent({
        model: "gemini-2.5-flash",
        contents: currentMessages,
        config: {
          systemInstruction,
          tools: [{ functionDeclarations: activeToolDeclarations }],
        },
      });

      const candidate = response.candidates?.[0];
      if (!candidate) {
        finalText = "I'm sorry, I wasn't able to process that. Could you try again?";
        break;
      }

      const parts = candidate.content?.parts ?? [];

      // Separate intercepted tool calls from real tool calls
      const allCalls = parts.filter((p) => p.functionCall);
      const interceptedNames = new Set(["suggest_quick_replies", "start_checkout"]);
      const quickReplyCall = allCalls.find(
        (p) => p.functionCall?.name === "suggest_quick_replies"
      );
      const checkoutCall = allCalls.find(
        (p) => p.functionCall?.name === "start_checkout"
      );
      const realCalls = allCalls.filter(
        (p) => !interceptedNames.has(p.functionCall?.name ?? "")
      );

      // Capture quick replies if present
      if (quickReplyCall) {
        const opts = quickReplyCall.functionCall?.args?.options;
        if (Array.isArray(opts)) {
          quickReplies = opts.map(String);
        }
      }

      // Capture booking checkout action if present
      if (checkoutCall) {
        const args = checkoutCall.functionCall?.args as Record<string, unknown> | undefined;
        if (args) {
          bookingAction = {
            date: String(args.date ?? ""),
            bay_name: String(args.bay_name ?? ""),
            start_time: String(args.start_time ?? ""),
            end_time: args.end_time ? String(args.end_time) : undefined,
            duration: typeof args.duration === "number" ? args.duration : undefined,
            price_cents: typeof args.price_cents === "number" ? args.price_cents : undefined,
            slot_ids: Array.isArray(args.slot_ids) ? args.slot_ids.map(String) : undefined,
          };
        }
      }

      // If no real tool calls, extract text and finish
      if (realCalls.length === 0) {
        finalText = parts
          .filter((p) => p.text)
          .map((p) => p.text)
          .join("");
        break;
      }

      // Add the model's response (real tool calls only) to the conversation
      const modelParts: Part[] = parts
        .filter((p) => !interceptedNames.has(p.functionCall?.name ?? ""))
        .map((p) => {
          if (p.functionCall) {
            return { functionCall: p.functionCall } as Part;
          }
          return { text: p.text ?? "" } as Part;
        });

      currentMessages.push({ role: "model", parts: modelParts });

      // Execute each real function call and build response parts
      const responseParts: Part[] = [];

      for (const part of realCalls) {
        const call = part.functionCall!;
        let result: Record<string, unknown>;

        switch (call.name) {
          case "get_facility_info":
            result = await executeFacilityInfo(orgContext);
            break;
          case "get_available_slots":
            result = await executeAvailableSlots(
              orgContext,
              call.args as { date: string; duration?: number; bay_name?: string; resource_type?: string }
            );
            break;
          case "get_my_bookings":
            result = await executeGetMyBookings(
              orgContext,
              customerId,
              call.args as { status_filter?: string }
            );
            break;
          case "create_booking":
            result = await executeCreateBooking(
              orgContext,
              customerId,
              call.args as {
                slot_ids?: string[];
                date?: string;
                bay_name?: string;
                start_time?: string;
                end_time?: string;
                price_cents?: number;
                notes?: string;
              },
              paymentContext
            );
            break;
          case "cancel_booking":
            result = await executeCancelBooking(
              orgContext,
              customerId,
              call.args as { confirmation_code: string }
            );
            break;
          case "get_events":
            result = await executeGetEvents(
              orgContext,
              call.args as { date?: string },
              customerId,
              {
                isMember: membershipInfo.isMember,
                eventDiscountType: membershipInfo.eventDiscountType,
                eventDiscountValue: membershipInfo.eventDiscountValue,
              }
            );
            break;
          case "register_for_event":
            result = await executeRegisterForEvent(
              orgContext,
              call.args as { event_id: string },
              customerId,
              {
                isMember: membershipInfo.isMember,
                eventDiscountType: membershipInfo.eventDiscountType,
                eventDiscountValue: membershipInfo.eventDiscountValue,
              }
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

    // Append booking action delimiter if present (before quick replies)
    if (bookingAction) {
      finalText += `\n\n<<BOOKING_ACTION>>\n${JSON.stringify(bookingAction)}`;
    }

    // Append quick replies delimiter if present
    if (quickReplies.length > 0) {
      finalText += `\n\n<<QUICK_REPLIES>>\n${JSON.stringify(quickReplies)}`;
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
