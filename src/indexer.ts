import dotenv from "dotenv";
import axios, { AxiosInstance } from "axios";

// Load environment variables from .env file
dotenv.config();

// Configuration - no fallbacks, require these to be set
const MASA_API_BASE_URL = "https://data.masa.ai/api/v1/search/live/twitter";
const BEARER_TOKEN = process.env.MASA_BEARER_TOKEN!;
const DEFAULT_QUERY = process.env.DEFAULT_QUERY!;
const DEFAULT_MAX_RESULTS = parseInt(process.env.DEFAULT_MAX_RESULTS!, 10);

// Hardcoded configuration
const POLL_INTERVAL_MS = 5000; // 5 seconds
const MAX_WAIT_TIME_MS = 300000; // 5 minutes
const DELAY_BETWEEN_JOBS = 5000; // 5 seconds
const MAX_CONSECUTIVE_IN_PROGRESS = 10;

interface MasaJobRequest {
  type: string;
  arguments: {
    query: string;
    max_results: number;
  };
}

interface MasaJobResponse {
  uuid: string;
}

interface MasaResultResponse {
  [key: string]: any;
}

export class MasaIndexer {
  private httpClient: AxiosInstance;

  constructor() {
    this.httpClient = axios.create({
      baseURL: MASA_API_BASE_URL,
      headers: {
        Authorization: `Bearer ${BEARER_TOKEN}`,
        "Content-Type": "application/json",
      },
      timeout: 30000,
    });

    console.log(`🚀 Masa Indexer initialized`);
  }

  /**
   * Randomize the month and day in an "until" clause while keeping the same year
   */
  private randomizeUntilDate(query: string): string {
    const untilPattern = /until:(\d{4})-(\d{2})-(\d{2})/i;
    const match = query.match(untilPattern);

    if (!match) {
      return query;
    }

    const [fullMatch, year] = match;

    // Generate random month (1-12) and day (1-28 to avoid invalid dates)
    const randomMonth = Math.floor(Math.random() * 12) + 1;
    const randomDay = Math.floor(Math.random() * 28) + 1;

    // Format with leading zeros
    const formattedMonth = randomMonth.toString().padStart(2, "0");
    const formattedDay = randomDay.toString().padStart(2, "0");

    const newUntilClause = `until:${year}-${formattedMonth}-${formattedDay}`;
    const newQuery = query.replace(untilPattern, newUntilClause);

    console.log(`🎲 Randomized until date: ${fullMatch} → ${newUntilClause}`);

    return newQuery;
  }

  /**
   * Create a new job request
   */
  async createJobRequest(): Promise<string> {
    const processedQuery = this.randomizeUntilDate(DEFAULT_QUERY);

    const requestPayload: MasaJobRequest = {
      type: "twitter-credential-scraper",
      arguments: {
        query: processedQuery,
        max_results: DEFAULT_MAX_RESULTS,
      },
    };

    console.log(`📝 Creating job request for: ${processedQuery}`);

    try {
      const response = await this.httpClient.post("", requestPayload);
      const jobResponse: MasaJobResponse = response.data;
      console.log(`✅ Job created: ${jobResponse.uuid}`);
      return jobResponse.uuid;
    } catch (error: any) {
      console.error(`❌ Failed to create job: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get job result
   */
  async getJobResult(jobUuid: string): Promise<MasaResultResponse> {
    try {
      const response = await this.httpClient.get(`/result/${jobUuid}`);
      return response.data;
    } catch (error: any) {
      throw error;
    }
  }

  /**
   * Check if result is actual data or status object
   */
  private isActualData(result: any): boolean {
    if (Array.isArray(result)) {
      return true;
    }

    if (
      typeof result === "object" &&
      result !== null &&
      "status" in result &&
      "error" in result &&
      Object.keys(result).length <= 2
    ) {
      return false;
    }

    if (typeof result === "object" && result !== null) {
      const hasArrayData = Object.values(result).some((value) => Array.isArray(value));
      if (hasArrayData) {
        return true;
      }
    }

    return true;
  }

  /**
   * Poll job until complete (max 10 "in progress" attempts)
   */
  async pollJobUntilComplete(jobUuid: string): Promise<MasaResultResponse | null> {
    const startTime = Date.now();
    let attempts = 0;
    let consecutiveInProgressCount = 0;

    console.log(
      `⏳ Polling job ${jobUuid} (max ${MAX_CONSECUTIVE_IN_PROGRESS} "in progress" attempts)`
    );

    while (Date.now() - startTime < MAX_WAIT_TIME_MS) {
      attempts++;
      const elapsedTime = Math.round((Date.now() - startTime) / 1000);

      console.log(`🔄 Poll attempt #${attempts} (${elapsedTime}s elapsed)`);

      try {
        const result = await this.getJobResult(jobUuid);

        if (this.isActualData(result)) {
          console.log(`✅ Job completed! Got data.`);
          return result;
        } else {
          consecutiveInProgressCount++;
          console.log(
            `   📄 "in progress" response (${consecutiveInProgressCount}/${MAX_CONSECUTIVE_IN_PROGRESS})`
          );

          if (consecutiveInProgressCount >= MAX_CONSECUTIVE_IN_PROGRESS) {
            console.log(`💀 Giving up after ${MAX_CONSECUTIVE_IN_PROGRESS} "in progress" attempts`);
            return null;
          }

          await this.sleep(POLL_INTERVAL_MS);
          continue;
        }
      } catch (error: any) {
        consecutiveInProgressCount = 0; // Reset on error

        // Continue polling for expected "not ready" errors
        if (error.response?.status === 404 || error.response?.status === 202) {
          console.log(`   🔄 Job not ready yet, continuing...`);
          await this.sleep(POLL_INTERVAL_MS);
          continue;
        }

        if (error.response?.status === 500) {
          const responseData = error.response?.data;
          if (responseData && typeof responseData === "object") {
            const errorMessage = responseData.details || responseData.error || "";
            if (
              errorMessage.includes("still processing") ||
              errorMessage.includes("not ready yet")
            ) {
              console.log(`   🔄 Still processing, continuing...`);
              await this.sleep(POLL_INTERVAL_MS);
              continue;
            }
          }
        }

        console.error(`💀 Job failed: ${error.message}`);
        return null;
      }
    }

    console.error(`⏰ Timeout after ${Math.round((Date.now() - startTime) / 1000)}s`);
    return null;
  }

  /**
   * Execute a single job: create, poll, get result
   */
  async executeSingleJob(): Promise<MasaResultResponse | null> {
    try {
      const jobUuid = await this.createJobRequest();
      const result = await this.pollJobUntilComplete(jobUuid);
      return result;
    } catch (error: any) {
      console.error(`❌ Job execution failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Run continuous harvesting loop
   */
  async runContinuous(): Promise<void> {
    console.log(`🔄 Starting continuous harvesting`);
    console.log(`   Query: "${DEFAULT_QUERY}"`);
    console.log(`   Max Results: ${DEFAULT_MAX_RESULTS}`);

    let jobCount = 0;
    let successCount = 0;

    while (true) {
      jobCount++;
      console.log(`\n🎯 === JOB #${jobCount} ===`);
      console.log(`📊 Success rate: ${successCount}/${jobCount - 1}`);

      const result = await this.executeSingleJob();

      if (result) {
        successCount++;

        // Save result
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const filename = `masa-result-job${jobCount}-${timestamp}.json`;

        try {
          const fs = require("fs");
          fs.writeFileSync(filename, JSON.stringify(result, null, 2));
          console.log(`💾 Saved: ${filename}`);
        } catch (saveError) {
          console.log(`⚠️  Could not save result: ${saveError}`);
        }
      } else {
        console.log(`💥 Job #${jobCount} failed, moving on`);
      }

      console.log(`⏸️  Waiting ${DELAY_BETWEEN_JOBS / 1000}s before next job...`);
      await this.sleep(DELAY_BETWEEN_JOBS);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Main function
 */
async function main(): Promise<void> {
  console.log(`🚀 Masa AI Indexer Starting...`);

  // Validate required environment variables
  if (!BEARER_TOKEN) {
    console.error(`❌ MASA_BEARER_TOKEN is required`);
    process.exit(1);
  }
  if (!DEFAULT_QUERY) {
    console.error(`❌ DEFAULT_QUERY is required`);
    process.exit(1);
  }
  if (isNaN(DEFAULT_MAX_RESULTS)) {
    console.error(`❌ DEFAULT_MAX_RESULTS must be a valid number`);
    process.exit(1);
  }

  try {
    const indexer = new MasaIndexer();
    await indexer.runContinuous();
  } catch (error: any) {
    console.error(`💥 Indexer failed: ${error.message}`);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch((error) => {
    console.error(`💥 Unhandled error: ${error.message}`);
    process.exit(1);
  });
}
