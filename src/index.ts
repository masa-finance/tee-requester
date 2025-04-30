import dotenv from "dotenv";
import { TeeClient, JobResponse } from "./client";

// Load environment variables from .env file
dotenv.config();

// Get environment variables with defaults
const workerUrl = process.env.WORKER_URL || "https://localhost:8080";
const allowSelfSigned = process.env.ALLOW_INSECURE_TLS === "true";
const query = process.env.TWITTER_QUERY || "#AI trending";
const maxResults = parseInt(process.env.MAX_RESULTS || "10", 10);

// Command line arguments can override environment variables
// Format: npm start -- "custom query" 20
if (process.argv.length > 2) {
  const argQuery = process.argv[2];
  if (argQuery) {
    console.log(`Using query from command line: ${argQuery}`);
    process.env.TWITTER_QUERY = argQuery;
  }
}

if (process.argv.length > 3) {
  const argMaxResults = parseInt(process.argv[3], 10);
  if (!isNaN(argMaxResults)) {
    console.log(`Using max results from command line: ${argMaxResults}`);
    process.env.MAX_RESULTS = argMaxResults.toString();
  }
}

/**
 * Main function to execute Twitter job
 */
async function main(): Promise<void> {
  console.log("Starting Twitter scraper client");
  console.log(`Worker URL: ${workerUrl}`);
  console.log(`Allow self-signed certificates: ${allowSelfSigned}`);

  // Create the TeeClient
  const client = new TeeClient(workerUrl, allowSelfSigned);

  try {
    console.log(`Executing Twitter search for "${query}" with max results: ${maxResults}`);

    // Execute the Twitter sequence
    const result: JobResponse = await client.executeTwitterSequence(
      query,
      maxResults,
      3, // maxRetries
      2000 // delay between retries (ms)
    );

    // Check if the operation was successful
    if (result.success && result.result) {
      console.log("\n✅ Twitter search completed successfully!");
      console.log("\nResults:");
      console.log(JSON.stringify(result.result, null, 2));
    } else {
      console.error("\n❌ Twitter search failed:");
      console.error(`Error: ${result.error || "Unknown error"}`);
      if (result.result) {
        console.error("Result data:");
        console.error(JSON.stringify(result.result, null, 2));
      }
      process.exit(1);
    }
  } catch (error) {
    console.error("Unexpected error:", error);
    process.exit(1);
  }
}

// Run the main function
main().catch((error) => {
  console.error("Unhandled error:", error);
  process.exit(1);
});
