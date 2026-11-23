// Emails support@wotri.app when someone reports a post, comment, photo or
// user, so reports get seen within the 24 hours the Terms promise.
//
// Called by a Database Webhook on INSERT into public.reports, which sends
// the x-webhook-secret header. "Verify JWT" is off for this function; the
// secret is what keeps anyone else from calling it.
//
// Secrets:  RESEND_API_KEY, REPORT_WEBHOOK_SECRET

import { createClient } from "npm:@supabase/supabase-js@2";

const TO = "support@wotri.app";
const FROM = "Wotri Reports <reports@wotri.app>";

const REASONS: Record<string, string> = {
  spam: "Spam or advertising",
  offensive: "Offensive or inappropriate",
  harassment: "Harassment or bullying",
  not_food: "Not about food",
  other: "Other",
};

const TARGETS: Record<string, string> = {
  review: "a review",
  comment: "a comment",
  restaurant_note: "a restaurant note",
  restaurant_photo: "a restaurant photo",
  restaurant_comment: "a restaurant comment",
  user: "a user",
};

type Report = {
  id: string;
  reporter_id: string;
  target_type: string;
  target_id: string;
  reported_user_id: string | null;
  reason: string;
  details: string | null;
  created_at: string;
};

function escapeHtml(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("REPORT_WEBHOOK_SECRET");

  if (!secret || req.headers.get("x-webhook-secret") !== secret) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const payload = await req.json();
    const report = payload?.record as Report | undefined;

    if (payload?.type !== "INSERT" || !report?.id) {
      return new Response("Ignored", { status: 200 });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const userIds = [report.reporter_id, report.reported_user_id].filter(
      (id): id is string => Boolean(id),
    );

    const { data: profiles } = await admin
      .from("profiles")
      .select("id, username")
      .in("id", userIds);

    const username = (id: string | null) => {
      if (!id) return "unknown";
      const name = profiles?.find((profile) => profile.id === id)?.username;
      return name ? `@${name}` : id;
    };

    // Earlier open reports against the same person, to spot repeat offenders.
    let openAgainstUser = 0;
    if (report.reported_user_id) {
      const { count } = await admin
        .from("reports")
        .select("id", { count: "exact", head: true })
        .eq("reported_user_id", report.reported_user_id)
        .eq("status", "open");
      openAgainstUser = count ?? 0;
    }

    const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
    const dashboardUrl =
      `https://supabase.com/dashboard/project/${projectRef}/editor`;

    const what = TARGETS[report.target_type] ?? report.target_type;
    const why = REASONS[report.reason] ?? report.reason;
    const reported = username(report.reported_user_id);

    const rows: [string, string][] = [
      ["Reported", what],
      ["Reason", why],
      ["Posted by", reported],
      ["Reported by", username(report.reporter_id)],
      ["Item id", report.target_id],
      ["Report id", report.id],
      ["Open reports on this user", String(openAgainstUser)],
    ];
    if (report.details) rows.splice(2, 0, ["Details", report.details]);

    const html = `
      <div style="font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;color:#1a1a1a;">
        <p>Someone reported ${escapeHtml(what)} on Wotri. Review it within 24 hours.</p>
        <table cellpadding="6" style="border-collapse:collapse;">
          ${
      rows.map(([label, value]) =>
        `<tr><td style="color:#777;">${escapeHtml(label)}</td><td><b>${
          escapeHtml(value)
        }</b></td></tr>`
      ).join("")
    }
        </table>
        <p><a href="${dashboardUrl}">Open the reports table in Supabase</a></p>
      </div>`;

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${Deno.env.get("RESEND_API_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM,
        to: [TO],
        subject: `Report: ${what} by ${reported} (${why})`,
        html,
        text: rows.map(([label, value]) => `${label}: ${value}`).join("\n"),
      }),
    });

    if (!response.ok) {
      console.error("Resend error:", response.status, await response.text());
      return new Response("Email failed", { status: 502 });
    }

    return new Response("Sent", { status: 200 });
  } catch (error) {
    console.error(error);
    return new Response("Error", { status: 500 });
  }
});
