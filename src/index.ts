import dotenv from "dotenv";
import { TeeClient, JobResponse } from "./client";

// Load environment variables from .env file
dotenv.config();

// Get environment variables with defaults
const workerUrls = (process.env.WORKER_URLS || "https://localhost:8080")
  .split(",")
  .map((url) => url.trim());
const allowSelfSigned = process.env.ALLOW_INSECURE_TLS === "true";
// Get job types from environment or use defaults
const JOB_TYPES = (process.env.JOB_TYPES || "searchbyquery,hometweets,foryoutweets")
  .split(",")
  .map((type) => type.trim())
  .filter((type) => ["searchbyquery", "hometweets", "foryoutweets", "getbyid"].includes(type));

// Use all three job types as fallback if no valid types were found
if (JOB_TYPES.length === 0) {
  JOB_TYPES.push("searchbyquery", "hometweets", "foryoutweets", "getbyid");
}

const twitterQueries = (process.env.TWITTER_QUERIES || "#AI trending")
  .split(",")
  .map((query) => query.trim());
const maxResultsList = (process.env.MAX_RESULTS || "10")
  .split(",")
  .map((num) => parseInt(num.trim(), 10))
  .filter((num) => !isNaN(num));
const cadencesList = (process.env.CADENCES || "60")
  .split(",")
  .map((num) => parseInt(num.trim(), 10))
  .filter((num) => !isNaN(num));
const maxJobWaitTimeMs = parseInt(process.env.MAX_JOB_WAIT_TIME_MS || "30000", 10);
const initialPollIntervalMs = parseInt(process.env.INITIAL_POLL_INTERVAL_MS || "2000", 10);
const maxRetries = parseInt(process.env.MAX_RETRIES || "3", 10);

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
async function executeWorkerJob(
  workerUrl: string,
  query: string,
  maxResults: number,
  jobType: string
): Promise<JobResponse> {
  console.log(`Worker URL: ${workerUrl}`);
  if (jobType === "searchbyquery") {
    console.log(`Query: ${query}`);
  }
  console.log(`Job Type: ${jobType}`);
  console.log(`Allow self-signed certificates: ${allowSelfSigned}`);

  // Create the TeeClient
  const client = new TeeClient(workerUrl, allowSelfSigned);

  try {
    if (jobType === "hometweets") {
      console.log(`Executing Twitter home timeline with max results: ${maxResults}`);
    } else if (jobType === "foryoutweets") {
      console.log(`Executing Twitter 'For You' timeline with max results: ${maxResults}`);
    } else {
      console.log(`Executing Twitter search for "${query}" with max results: ${maxResults}`);
    }
    console.log(
      `Max wait time: ${maxJobWaitTimeMs}ms, Initial poll interval: ${initialPollIntervalMs}ms, Max retries: ${maxRetries}`
    );

    // Override the default JOB_TYPE for this specific request
    process.env.JOB_TYPE = jobType;

    // Execute the Twitter sequence
    const result: JobResponse = await client.executeTwitterSequence(
      query,
      maxResults,
      maxRetries,
      maxJobWaitTimeMs / maxRetries // use as delay between retries
    );

    return result;
  } catch (error) {
    console.error(`Error with worker ${workerUrl}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      metadata: {
        ...(jobType === "searchbyquery" ? { query } : {}),
        maxResults,
        workerUrl,
        jobType,
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
 * Extract and format tweet information for logging
 */
function extractTweetInfo(result: any): any[] {
  const tweets: any[] = [];

  if (!result) return tweets;

  try {
    // Handle different possible result structures
    let tweetArray: any[] = [];

    // Case 1: Direct array of tweets
    if (Array.isArray(result)) {
      tweetArray = result;
    }
    // Case 2: Object with data array
    else if (result.data && Array.isArray(result.data)) {
      tweetArray = result.data;
    }
    // Case 3: Object with tweets array
    else if (result.tweets && Array.isArray(result.tweets)) {
      tweetArray = result.tweets;
    }
    // Case: 4: Object with statuses array (Twitter API format)
    else if (result.statuses && Array.isArray(result.statuses)) {
      tweetArray = result.statuses;
    }
    // Case 5: Search for any array in the result object
    else if (typeof result === "object") {
      for (const key in result) {
        if (Array.isArray(result[key])) {
          tweetArray = result[key];
          break;
        }
      }
    }

    // Extract relevant information from each tweet
    tweetArray.forEach((tweet: any) => {
      let text = null;
      let id = null;

      // Extract tweet ID
      if (tweet.id) {
        id = tweet.id;
      } else if (tweet.id_str) {
        id = tweet.id_str;
      } else if (tweet.tweet_id) {
        id = tweet.tweet_id;
      }

      // Extract text content
      if (tweet.text) {
        text = tweet.text;
      } else if (tweet.full_text) {
        text = tweet.full_text;
      } else if (tweet.content) {
        text = tweet.content;
      } else if (tweet.message) {
        text = tweet.message;
      } else if (tweet.body) {
        text = tweet.body;
      } else if (tweet.caption) {
        text = tweet.caption;
      } else if (typeof tweet === "string") {
        // The tweet itself could be just a string
        text = tweet;
      }

      if (text) {
        tweets.push({
          id: id || "Unknown ID",
          text: text,
        });
      }
    });
  } catch (e) {
    console.error("Error extracting tweet info:", e);
  }

  return tweets;
}

/**
 * Main function to execute Twitter jobs across all workers
 */
async function executeRun(initialCadence: number): Promise<void> {
  console.log("Starting Twitter scraper client");

  const processedResults: { [key: string]: JobResponse & { jobType?: string } } = {};

  // Create different random queries for each worker
  console.log(
    `Sending requests to ${workerUrls.length} workers simultaneously with different queries...`
  );

  // Prepare job promises with different queries for each worker
  const jobPromises: Promise<JobResponse>[] = [];
  const workerQueries: { [key: string]: string } = {};
  const workerMaxResults: { [key: string]: number } = {};
  const workerJobTypes: { [key: string]: string } = {};

  // Assign a different random query and job type to each worker
  for (const workerUrl of workerUrls) {
    const randomQuery = getRandomItem(twitterQueries);
    const randomMaxResults = getRandomItem(maxResultsList);
    const randomJobType = getRandomItem(JOB_TYPES);

    workerQueries[workerUrl] = randomQuery;
    workerMaxResults[workerUrl] = randomMaxResults;
    workerJobTypes[workerUrl] = randomJobType;

    console.log(`\nWorker: ${workerUrl}`);
    console.log(`Selected job type for this worker: "${randomJobType}"`);
    if (randomJobType === "searchbyquery") {
      console.log(`Selected query for this worker: "${randomQuery}"`);
    }
    console.log(`Selected max results for this worker: ${randomMaxResults}`);

    jobPromises.push(executeWorkerJob(workerUrl, randomQuery, randomMaxResults, randomJobType));
  }

  // Wait for all promises to settle (either resolve or reject)
  console.log("\nExecuting all worker jobs simultaneously...");
  const results = await Promise.allSettled(jobPromises);

  // Process results
  results.forEach((result, index) => {
    const workerUrl = workerUrls[index];
    const jobType = workerJobTypes[workerUrl];

    if (result.status === "fulfilled") {
      processedResults[workerUrl] = {
        ...result.value,
        jobType,
      };

      // Log individual results
      if (result.value.success && result.value.result) {
        console.log(`\n✅ Twitter ${jobType} completed successfully for ${workerUrl}!`);

        // Diagnostic log to see the structure of the result
        console.log("\n🔍 DEBUG - Raw Result Structure:");
        console.log("---------------------------------------------");
        console.log("Result type:", typeof result.value.result);
        if (Array.isArray(result.value.result)) {
          console.log("Is Array of length:", result.value.result.length);
          if (result.value.result.length > 0) {
            console.log("First item keys:", Object.keys(result.value.result[0]));
            console.log(
              "Sample first item:",
              JSON.stringify(result.value.result[0], null, 2).substring(0, 1000) + "..."
            );
          }
        } else if (typeof result.value.result === "object") {
          console.log("Object keys:", Object.keys(result.value.result));
          // Look for arrays in the result object
          for (const key in result.value.result) {
            if (Array.isArray(result.value.result[key])) {
              console.log(
                `Found array in key "${key}" with length:`,
                result.value.result[key].length
              );
              if (result.value.result[key].length > 0) {
                console.log(
                  `Sample item from "${key}":`,
                  JSON.stringify(result.value.result[key][0], null, 2).substring(0, 1000) + "..."
                );
              }
            }
          }
        }
        console.log("---------------------------------------------");
      }
    } else {
      // Handle rejected promises
      processedResults[workerUrl] = {
        success: false,
        error: result.reason?.toString() || "Promise rejected",
        jobType,
        metadata: {
          ...(jobType === "searchbyquery"
            ? { query: workerQueries[workerUrl] || "Unknown query" }
            : {}),
          maxResults: workerMaxResults[workerUrl] || 0,
          workerUrl,
          jobType,
          timing: {
            executedAt: new Date().toISOString(),
          },
        },
      };
    }
  });

  // Generate report
  generateRunReport(processedResults, "Multiple queries used", 0, initialCadence);

  return;
}

/**
 * Generate a report for the current run
 */
function generateRunReport(
  results: { [key: string]: JobResponse & { jobType?: string } },
  queryInfo: string,
  maxResultsInfo: number,
  cadence: number
): void {
  console.log("\n---------------------------------------------");
  console.log(`📊 REPORT: Twitter Jobs Summary`);

  // Count job types
  const jobTypeCounts: Record<string, number> = {};
  for (const [_, result] of Object.entries(results)) {
    const jobType = result.jobType || "unknown";
    jobTypeCounts[jobType] = (jobTypeCounts[jobType] || 0) + 1;
  }

  // Display job type counts
  console.log("Job Types Used:");
  for (const [type, count] of Object.entries(jobTypeCounts)) {
    console.log(`  - ${type}: ${count} worker(s)`);
  }

  // Only show query info if we have searchbyquery jobs
  if (jobTypeCounts["searchbyquery"]) {
    if (queryInfo === "Multiple queries used") {
      console.log(`Queries: Multiple different queries were used`);
    } else {
      console.log(`Query: "${queryInfo}"`);
    }
  }

  // If maxResultsInfo is 0, it means we used multiple different max results
  if (maxResultsInfo === 0) {
    console.log(`Max Results: Different for each worker`);
  } else {
    console.log(`Max Results: ${maxResultsInfo}`);
  }

  console.log(`Wait: ${cadence} seconds`);
  console.log("---------------------------------------------");

  let successCount = 0;
  let failureCount = 0;
  let inProgressCount = 0;
  let tweetsInThisRun = 0;
  const allTweets: { worker: string; tweets: any[] }[] = [];

  for (const [workerUrl, result] of Object.entries(results)) {
    const workerName = workerUrl.replace("https://", "");
    const jobType = result.jobType || "unknown";

    if (result.success && result.result) {
      // Use the tweetCount from metadata if available, otherwise count manually
      const tweetCount = result.metadata.tweetCount || countTweetsInResult(result.result);
      tweetsInThisRun += tweetCount;
      successCount++;

      if (jobType === "searchbyquery") {
        console.log(
          `✅ Worker ${workerName} (${jobType}): ${tweetCount} tweets (Query: "${result.metadata.query}")`
        );
      } else {
        console.log(`✅ Worker ${workerName} (${jobType}): ${tweetCount} tweets`);
      }

      // Extract tweet information
      const tweetInfo = extractTweetInfo(result.result);
      if (tweetInfo.length > 0) {
        allTweets.push({
          worker: workerName,
          tweets: tweetInfo,
        });
      }
    } else {
      // Check if this was a job-in-progress situation
      if (result.metadata.jobStatus && !result.metadata.jobStatus.complete) {
        // Check if the status contains a 500 error
        if (result.metadata.jobStatus.status?.includes("500")) {
          failureCount++;
          console.log(
            `❌ Worker ${workerName} (${jobType}): Failed - ${result.metadata.jobStatus.status}`
          );
        } else {
          inProgressCount++;
          const attempts = result.metadata.jobStatus.attempts || 0;
          const jobId = result.metadata.jobStatus.jobId || "unknown";
          const responseTime = result.metadata.timing.responseTimeMs || 0;

          console.log(`⏳ Worker ${workerName} (${jobType}): In progress - JobID: ${jobId}`);
          console.log(`   - Attempts: ${attempts}, Response time: ${responseTime}ms`);
          console.log(`   - Status: ${result.metadata.jobStatus.status || "No status available"}`);
        }
      } else {
        failureCount++;
        console.log(
          `❌ Worker ${workerName} (${jobType}): Failed - ${result.error || "Unknown error"}`
        );
      }
    }
  }

  // Update total tweet count
  totalTweetCount += tweetsInThisRun;

  console.log("---------------------------------------------");
  console.log(
    `Workers Summary: ${successCount} succeeded, ${failureCount} failed, ${inProgressCount} in progress`
  );
  console.log(`Tweets in this run: ${tweetsInThisRun}`);
  console.log(`Total tweets scraped: ${totalTweetCount}`);
  console.log("---------------------------------------------");
}

/**
 * Main function with optional repeated execution based on cadence
 */
async function main(): Promise<void> {
  // Execute first run immediately
  await runWithRandomCadence();
}

/**
 * Schedule and execute a run with a new random cadence
 */
async function runWithRandomCadence(): Promise<void> {
  // Select a random cadence for this run
  const randomCadence = getRandomItem(cadencesList);
  console.log(`\n=================================================`);
  console.log(`Selected random wait time between groups: ${randomCadence} seconds`);
  console.log(`=================================================\n`);

  if (randomCadence <= 0) {
    // Run once and exit if cadence is 0 or negative
    await executeRun(randomCadence);
    return;
  }

  // Execute the run with all miners at once but different queries
  await executeRun(randomCadence);

  // Schedule the next run with a new random cadence
  console.log(`\nAll miners completed. Next group run scheduled in ${randomCadence} seconds...`);
  setTimeout(runWithRandomCadence, randomCadence * 1000);
}

// Run the main function
main().catch((error) => {
  console.error("Unhandled error:", error);
  process.exit(1);
});
