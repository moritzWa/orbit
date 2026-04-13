// One-time OAuth flow to get a refresh token for Google Sheets API
// Set these in server/.env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
import "jsr:@std/dotenv/load";
const CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
const CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";
if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in server/.env");
  Deno.exit(1);
}
const REDIRECT_URI = "http://localhost:3000/oauth2callback";
const SCOPES = "https://www.googleapis.com/auth/spreadsheets";

const TOKEN_PATH = new URL("../../.sheets-token.json", import.meta.url).pathname;

// Step 1: Generate auth URL
const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent(SCOPES)}&access_type=offline&prompt=consent`;

console.log("Open this URL in your browser:\n");
console.log(authUrl);
console.log("\nWaiting for callback on localhost:3000...\n");

// Step 2: Listen for the callback
const server = Deno.serve({ port: 3000 }, async (req) => {
  const url = new URL(req.url);
  if (url.pathname === "/oauth2callback") {
    const code = url.searchParams.get("code");
    if (!code) return new Response("No code received", { status: 400 });

    // Exchange code for tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });

    const tokens = await tokenRes.json();
    if (tokens.error) {
      console.error("Token error:", tokens);
      return new Response(`Error: ${tokens.error_description}`, { status: 400 });
    }

    Deno.writeTextFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
    console.log(`Tokens saved to ${TOKEN_PATH}`);
    console.log("You can close this tab.");

    // Shut down after a short delay
    setTimeout(() => { server.shutdown(); Deno.exit(0); }, 500);

    return new Response("Auth complete! You can close this tab.", { status: 200 });
  }
  return new Response("Not found", { status: 404 });
});
