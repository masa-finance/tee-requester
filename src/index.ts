import dotenv from "dotenv";
import { TeeClient, JobResponse } from "./client";

// Load environment variables from .env file
dotenv.config();

// Get environment variables with defaults
const workerUrls = (process.env.WORKER_URLS || "https://localhost:8080")
  .split(",")
  .map((url) => url.trim());
const allowSelfSigned = process.env.ALLOW_INSECURE_TLS === "true";
const twitterQueries = (process.env.TWITTER_QUERIES || "#AI trending")
  .split(",")
  .map((query) => query.trim());
const maxResults = parseInt(process.env.MAX_RESULTS || "10", 10);
const cadence = parseInt(process.env.CADENCE || "0", 10); // Seconds between runs, 0 means run once and exit

// Tracking total tweets scraped
let totalTweetCount = 0;

// Command line arguments can override environment variables
// Format: npm start -- "custom query" 20
if (process.argv.length > 2) {
  const argQuery = process.argv[2];
  if (argQuery) {
    console.log(`Using query from command line: ${argQuery}`);
    process.env.TWITTER_QUERIES = argQuery;
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
 * Get a random item from an array
 */
function getRandomItem<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)];
}

/**
 * Execute Twitter job for a single worker
 */
async function executeWorkerJob(workerUrl: string, query: string): Promise<JobResponse> {
  console.log(`Worker URL: ${workerUrl}`);
  console.log(`Query: ${query}`);
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

    return result;
  } catch (error) {
    console.error(`Error with worker ${workerUrl}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      metadata: {
        query,
        maxResults,
        workerUrl,
        timing: {
          executedAt: new Date().toISOString(),
        },
      },
    };
  }
}

/**
 * Count tweets from results
 */
function countTweetsInResult(result: any): number {
  if (!result) return 0;

  try {
    // Handle different possible result structures
    if (Array.isArray(result)) {
      return result.length;
    } else if (result.data && Array.isArray(result.data)) {
      return result.data.length;
    } else if (result.tweets && Array.isArray(result.tweets)) {
      return result.tweets.length;
    } else if (typeof result === "object") {
      // Try to find an array in the result
      for (const key in result) {
        if (Array.isArray(result[key])) {
          return result[key].length;
        }
      }
    }
  } catch (e) {
    console.error("Error counting tweets:", e);
  }

  return 0;
}

/**
 * Generate a report for the current run
 */
function generateRunReport(results: { [key: string]: JobResponse }, query: string): void {
  console.log("\n---------------------------------------------");
  console.log(`📊 REPORT: Twitter Search Results for "${query}"`);
  console.log("---------------------------------------------");

  let successCount = 0;
  let failureCount = 0;
  let tweetsInThisRun = 0;

  for (const [workerUrl, result] of Object.entries(results)) {
    const workerName = workerUrl.replace(/^https?:\/\//, "").split(".")[0];

    if (result.success && result.result) {
      // Use the tweetCount from metadata if available, otherwise count manually
      const tweetCount = result.metadata.tweetCount || countTweetsInResult(result.result);
      tweetsInThisRun += tweetCount;
      successCount++;
      console.log(`✅ Worker ${workerName}: ${tweetCount} tweets`);
    } else {
      failureCount++;
      console.log(`❌ Worker ${workerName}: Failed - ${result.error || "Unknown error"}`);
    }
  }

  // Update total tweet count
  totalTweetCount += tweetsInThisRun;

  console.log("---------------------------------------------");
  console.log(`Workers Summary: ${successCount} succeeded, ${failureCount} failed`);
  console.log(`Tweets in this run: ${tweetsInThisRun}`);
  console.log(`Total tweets scraped: ${totalTweetCount}`);
  console.log("---------------------------------------------\n");
}

/**
 * Main function to execute Twitter jobs across all workers
 */
async function executeRun(): Promise<void> {
  console.log("Starting Twitter scraper client");

  // Select a random Twitter query for this run
  const randomQuery = getRandomItem(twitterQueries);
  console.log(`Selected random query: "${randomQuery}"`);

  // Process each worker URL simultaneously
  console.log(`Sending requests to ${workerUrls.length} workers simultaneously...`);

  const jobPromises = workerUrls.map((workerUrl) => executeWorkerJob(workerUrl, randomQuery));

  // Wait for all promises to settle (either resolve or reject)
  const results = await Promise.allSettled(jobPromises);

  // Process results
  const processedResults: { [key: string]: JobResponse } = {};

  results.forEach((result, index) => {
    const workerUrl = workerUrls[index];

    if (result.status === "fulfilled") {
      processedResults[workerUrl] = result.value;

      // Log individual results
      if (result.value.success && result.value.result) {
        console.log(`\n✅ Twitter search completed successfully for ${workerUrl}!`);
      } else {
        console.error(`\n❌ Twitter search failed for ${workerUrl}:`);
        console.error(`Error: ${result.value.error || "Unknown error"}`);
      }
    } else {
      // Handle rejected promises
      processedResults[workerUrl] = {
        success: false,
        error: result.reason?.toString() || "Promise rejected",
        metadata: {
          query: randomQuery,
          maxResults,
          workerUrl,
          timing: {
            executedAt: new Date().toISOString(),
          },
        },
      };
      console.error(`\n❌ Request to ${workerUrl} failed to complete`);
    }
  });

  // Generate report
  generateRunReport(processedResults, randomQuery);

  return;
}

/**
 * Main function with optional repeated execution based on cadence
 */
async function main(): Promise<void> {
  if (cadence <= 0) {
    // Run once and exit
    await executeRun();
    return;
  }

  // Run on a cadence (repeated schedule)
  console.log(`Running with a cadence of ${cadence} seconds`);

  // Execute immediately for the first time
  await executeRun();

  // Set up interval for repeated execution
  setInterval(async () => {
    console.log(`\n--- Executing scheduled run (${new Date().toISOString()}) ---\n`);
    try {
      await executeRun();
    } catch (error) {
      console.error("Error during scheduled run:", error);
    }
  }, cadence * 1000);
}

// Run the main function
main().catch((error) => {
  console.error("Unhandled error:", error);
  process.exit(1);
});
