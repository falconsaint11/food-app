// Reads one photo of a restaurant menu with Claude and returns the dishes on
// it, with suggested tags. Admins only. Nothing is saved here: the app shows
// the dishes for review and saves them with import_menu_dishes().
//
// Deploy:  supabase functions deploy menu-scan
// Secret:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//
// Request:  { image: <base64 JPEG/PNG/WebP>, mediaType: "image/jpeg" }
// Response: { dishes: [{ name, price, section, description, options, variants, tags }] }

import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp"];

// Base64 of a ~5 MB image, Claude's per-image limit.
const MAX_IMAGE_LENGTH = 6_900_000;

const SYSTEM_PROMPT = `You read photos of restaurant menus and list the dishes on them for a food rating app.

List every dish and drink a customer can order, once each. Write each name as printed, without prices, symbols or descriptions. Skip anything you can't read with confidence.

One entry per menu item, even when it comes with choices: "Quesadilla - add protein +$3" is one dish called "Quesadilla", not one per protein. Never invent dishes for combinations the menu doesn't name. Add-ons, sauces and upgrades are not dishes of their own.

- description: the ingredients or description printed with the dish, as written. "" if none.
- options: short notes on the choices printed for that dish, like "Add protein +$3", "Soft or crunchy", "Black or pinto beans", "Small $3.25 / Big $6". Choices printed for a whole section ("any taco soft or crunchy", "double stack any taco +$2") go on every dish in that section. Skip upgrades offered on every item on the menu.
- variants: when the menu names the flavors or proteins a dish comes in, and picking one makes it a noticeably different dish, list them as short labels: "Margaritas - mango, strawberry, lime" gives ["Mango", "Strawberry", "Lime"]; "Quesadilla - chicken, steak or shrimp +$3" gives ["Chicken", "Steak", "Shrimp"]. Use [] when the menu doesn't name them ("add protein +$3" alone). Small choices that don't change the dish much (soft or crunchy, bean type, size) go in options instead.
- price: the lowest price. For "$3.25/6", that's 3.25, with the sizes in options.
- If two different items share a name (a kids' quesadilla and a regular one), make the names distinct, like "Kids Quesadilla".

Tags: choose from the allowed list only.
- Food tags (burger, dessert, drink...): use your judgment from the name, section and description.
- Dietary tags (gluten-free, gluten-friendly, dairy-free, vegetarian, vegan): people with allergies rely on these, so only add one when the menu itself marks that dish - in words, with a symbol the menu's legend explains, or by listing it under a section such as "Gluten-Free". Never infer them from ingredients. A menu that says "gluten-friendly", "made without gluten" with a cross-contact warning, or "can be made gluten-free" means gluten-friendly, not gluten-free.
- Availability tags: limited-time when the menu marks the dish as limited time, LTO, "while it lasts" or a special for a set period; seasonal when it's marked seasonal or listed under a season ("Fall Menu", "Summer Specials"); secret-menu when the menu lists it as a secret or off-menu item. Only when the menu says so, never because a dish sounds seasonal.`;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Acts as the signed-in user, so database rules apply.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      {
        global: {
          headers: { Authorization: req.headers.get("Authorization") ?? "" },
        },
      },
    );

    const { data: isAdmin, error: adminError } = await supabase.rpc(
      "is_app_admin",
    );

    if (adminError || !isAdmin) {
      return json({ error: "Only admins can scan menus." }, 403);
    }

    const { image, mediaType } = await req.json();

    if (
      typeof image !== "string" ||
      image.length === 0 ||
      image.length > MAX_IMAGE_LENGTH ||
      !MEDIA_TYPES.includes(mediaType)
    ) {
      return json({ error: "Send one JPEG, PNG or WebP image under 5 MB." }, 400);
    }

    const { data: tags, error: tagsError } = await supabase
      .from("tags")
      .select("slug, label, kind")
      .order("sort_order");

    if (tagsError) throw new Error(tagsError.message);

    const tagList = (tags ?? [])
      .map((tag) => `${tag.slug} (${tag.label}, ${tag.kind})`)
      .join("\n");

    const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });

    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      // If a safety check declines the request, the API retries it on a
      // fallback model instead of returning a refusal.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM_PROMPT,
      output_config: {
        effort: "medium",
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["dishes"],
            properties: {
              dishes: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: [
                    "name",
                    "price",
                    "section",
                    "description",
                    "options",
                    "variants",
                    "tags",
                  ],
                  properties: {
                    name: { type: "string" },
                    price: {
                      type: "string",
                      description:
                        'Lowest price as a plain number like "12.99", or "" if none is shown.',
                    },
                    section: {
                      type: "string",
                      description:
                        'The menu section it is listed under, like "Burgers", or "".',
                    },
                    description: { type: "string" },
                    options: { type: "array", items: { type: "string" } },
                    variants: { type: "array", items: { type: "string" } },
                    tags: {
                      type: "array",
                      items: {
                        type: "string",
                        enum: (tags ?? []).map((tag) => tag.slug),
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: image },
            },
            {
              type: "text",
              text: `Allowed tags (slug, label, kind):\n${tagList}\n\nList the dishes on this menu page.`,
            },
          ],
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      return json({ error: "This photo couldn't be read. Try another." }, 422);
    }

    if (response.stop_reason === "max_tokens") {
      return json(
        { error: "This page has too many dishes. Photograph it in parts." },
        422,
      );
    }

    const text = response.content.find((block) => block.type === "text");

    if (!text || text.type !== "text") {
      return json({ error: "No dishes came back. Try another photo." }, 502);
    }

    const { dishes } = JSON.parse(text.text);

    return json({ dishes });
  } catch (error) {
    console.error("menu-scan error:", error);

    if (error instanceof Anthropic.RateLimitError) {
      return json({ error: "Too many scans right now. Try again in a minute." }, 429);
    }

    if (error instanceof Anthropic.APIError) {
      return json({ error: `Menu reader error (${error.status}).` }, 502);
    }

    return json({ error: "Something went wrong reading the menu." }, 500);
  }
});
