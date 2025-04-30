import axios, { AxiosInstance } from "axios";
import https from "https";

// Define the interfaces for job arguments and response
export interface Job {
  type: string;
  arguments: Record<string, any>;
}

export interface JobResponse {
  success: boolean;
  result?: any;
  error?: string;
  metadata: {
    query?: string;
    maxResults?: number;
    workerUrl?: string;
    tweetCount?: number;
    timing: {
      executedAt: string;
      responseTimeMs?: number;
    };
    rateLimit?: {
      limit: number;
      remaining: number;
      reset: number;
    };
  };
}

export class TeeClient {
  private teeWorkerAddress: string;
  private allowSelfSigned: boolean;
  private httpClient: AxiosInstance;

  constructor(teeWorkerAddress: string, allowSelfSigned: boolean = false) {
    this.teeWorkerAddress = teeWorkerAddress;
    this.allowSelfSigned = allowSelfSigned;

    console.log(
      `TEE worker address: ${this.teeWorkerAddress}, allowSelfSigned: ${this.allowSelfSigned}`
    );

    // Create the HTTP client with appropriate TLS settings
    this.httpClient = axios.create({
      baseURL: this.teeWorkerAddress,
      headers: { "Content-Type": "application/json" },
      httpsAgent: new https.Agent({
        rejectUnauthorized: !this.allowSelfSigned,
      }),
    });
  }

  /**
   * Generate a telemetry job signature
   */
  async generateTelemetryJob(): Promise<string | any> {
    console.log(`Generating telemetry job for TEE worker at: ${this.teeWorkerAddress}`);
    console.log(`Path: /job/generate`);

    try {
      const response = await this.httpClient.post("/job/generate", {
        type: "telemetry",
      });

      const signature = response.data;
      return signature;
    } catch (error: any) {
      console.log("Error response:", error.response?.status);
      if (error.response?.status === 500) {
        return { error: "MISSING_KEYS" };
      } else {
        throw new Error(`Failed to generate telemetry job: ${error.message}`);
      }
    }
  }

  /**
   * Generate a Twitter job signature
   */
  async generateTwitterJob(
    query: string = "#AI trending",
    maxResults: number = 10
  ): Promise<string> {
    try {
      const response = await this.httpClient.post("/job/generate", {
        type: "twitter-scraper",
        arguments: {
          max_results: maxResults,
          query: query,
          type: "searchbyquery",
        },
      });

      const signature = response.data;
      return signature;
    } catch (error: any) {
      throw new Error(`Failed to generate Twitter job: ${error.message}`);
    }
  }

  /**
   * Add a job to the TEE worker using a job signature
   */
  async addTelemetryJob(sig: string): Promise<string> {
    // Remove double quotes and backslashes if present
    if (sig.startsWith('"') && sig.endsWith('"')) {
      sig = sig.slice(1, -1);
    }
    sig = sig.replace(/\\/g, "");

    try {
      const response = await this.httpClient.post("/job/add", {
        encrypted_job: sig,
      });

      return response.data.uid;
    } catch (error: any) {
      throw new Error(`Failed to add telemetry job: ${error.message}`);
    }
  }

  /**
   * Check the status of a job
   */
  async checkTelemetryJob(jobUuid: string): Promise<string> {
    try {
      const response = await this.httpClient.get(`/job/status/${jobUuid}`);
      const signature = response.data;
      return signature;
    } catch (error: any) {
      throw new Error(`Failed to check telemetry job: ${error.message}`);
    }
  }

  /**
   * Decrypt and return the result of a job
   */
  async returnTelemetryJob(sig: string, resultSig: string): Promise<any> {
    // Remove quotes and backslashes from signatures
    if (resultSig.startsWith('"') && resultSig.endsWith('"')) {
      resultSig = resultSig.slice(1, -1);
    }
    resultSig = resultSig.replace(/\\/g, "");

    if (sig.startsWith('"') && sig.endsWith('"')) {
      sig = sig.slice(1, -1);
    }
    sig = sig.replace(/\\/g, "");

    console.log(`Submitting result to: ${this.teeWorkerAddress}`);

    try {
      const response = await this.httpClient.post("/job/result", {
        encrypted_result: resultSig,
        encrypted_request: sig,
      });

      return response.data;
    } catch (error: any) {
      throw new Error(`Failed to return telemetry job: ${error.message}`);
    }
  }

  /**
   * Count tweets in a result object
   */
  private countTweets(result: any): number {
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
   * Execute a complete telemetry sequence
   */
  async executeTelemetrySequence(
    maxRetries: number = 2,
    delay: number = 1000
  ): Promise<JobResponse> {
    let retries = 0;

    while (retries < maxRetries) {
      try {
        console.log("Generating telemetry job...");
        const sig = await this.generateTelemetryJob();

        if (sig && sig.error) {
          return {
            success: false,
            result: null,
            error: sig.error,
            metadata: {
              timing: {
                executedAt: new Date().toISOString(),
              },
            },
          };
        }
        console.log(`Generated job signature: ${sig.substring(0, 20)}...`);

        console.log("Adding telemetry job...");
        const jobUuid = await this.addTelemetryJob(sig);
        console.log(`Added job with UUID: ${jobUuid}`);

        console.log("Checking telemetry job status...");
        const statusSig = await this.checkTelemetryJob(jobUuid);
        console.log(`Job status signature: ${statusSig.substring(0, 20)}...`);

        console.log("Returning telemetry job result...");
        const result = await this.returnTelemetryJob(sig, statusSig);
        console.log(`Telemetry job result received`);

        return {
          success: true,
          result,
          metadata: {
            timing: {
              executedAt: new Date().toISOString(),
            },
          },
        };
      } catch (e: any) {
        console.log(e);
        console.warn(`Error in telemetry sequence: ${e.message}`);
        retries++;
        console.log(`Retrying... (${retries}/${maxRetries})`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    console.error("Max retries reached. Telemetry sequence failed.");
    return {
      success: false,
      error: "Max retries reached",
      metadata: {
        timing: {
          executedAt: new Date().toISOString(),
        },
      },
    };
  }

  /**
   * Execute a complete Twitter sequence
   */
  async executeTwitterSequence(
    query: string,
    maxResults: number,
    maxRetries: number = 3,
    delay: number = 5000
  ): Promise<JobResponse> {
    try {
      console.log("Generating Twitter job...");
      const sig = await this.generateTwitterJob(query, maxResults);
      console.log(`Generated job signature: ${sig.substring(0, 20)}...`);

      console.log("Adding Twitter job...");
      const jobUuid = await this.addTelemetryJob(sig);
      console.log(`Added job with UUID: ${jobUuid}`);

      // For these operations, we'll implement retries
      let retries = 0;
      let statusSig: string;
      let result: any;

      // Retry loop for checking telemetry job status
      while (true) {
        try {
          console.log("Checking Twitter job status...");
          statusSig = await this.checkTelemetryJob(jobUuid);
          console.log(`Job status signature: ${statusSig.substring(0, 20)}...`);
          break; // Success, exit the loop
        } catch (e: any) {
          console.warn(`Error checking Twitter job status: ${e.message}`);
          retries++;
          if (retries >= maxRetries) throw e; // Max retries reached, rethrow
          console.log(`Retrying status check... (${retries}/${maxRetries})`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      // Reset retries for the next operation
      retries = 0;

      // Retry loop for returning telemetry job result
      while (true) {
        try {
          console.log("Returning Twitter job result...");
          result = await this.returnTelemetryJob(sig, statusSig);
          console.log(`Twitter job result received`);
          break; // Success, exit the loop
        } catch (e: any) {
          console.warn(`Error returning Twitter job result: ${e.message}`);
          retries++;
          if (retries >= maxRetries) throw e; // Max retries reached, rethrow
          console.log(`Retrying result fetch... (${retries}/${maxRetries})`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      // Count tweets in the result
      const tweetCount = this.countTweets(result);

      return {
        success: true,
        result,
        metadata: {
          query,
          maxResults,
          workerUrl: this.teeWorkerAddress,
          tweetCount,
          timing: {
            executedAt: new Date().toISOString(),
          },
        },
      };
    } catch (e: any) {
      console.error(`Twitter sequence failed: ${e.message}`);
      return {
        success: false,
        error: e.message || "Twitter sequence failed",
        metadata: {
          query,
          maxResults,
          workerUrl: this.teeWorkerAddress,
          tweetCount: 0,
          timing: {
            executedAt: new Date().toISOString(),
          },
        },
      };
    }
  }
}
