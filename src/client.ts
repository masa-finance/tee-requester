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
    jobType?: string;
    timing: {
      executedAt: string;
      responseTimeMs?: number;
    };
    rateLimit?: {
      limit: number;
      remaining: number;
      reset: number;
    };
    jobStatus?: {
      complete: boolean;
      attempts: number;
      jobId: string;
      status?: string;
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
        type: "twitter-credential-scraper",
        worker_id: "213d204a-58f1-4b2c-9039-7869f634d99c",
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

  async generateHomeTweetsJob(maxResults: number = 10): Promise<string> {
    try {
      const response = await this.httpClient.post("/job/generate", {
        type: "twitter-credential-scraper",
        worker_id: "213d204a-58f1-4b2c-9039-7869f634d99c",
        arguments: {
          count: maxResults,
          type: "gethometweets",
        },
      });

      const signature = response.data;
      return signature;
    } catch (error: any) {
      throw new Error(`Failed to generate Twitter job: ${error.message}`);
    }
  }

  async generateForYouTweetsJob(maxResults: number = 10): Promise<string> {
    try {
      const response = await this.httpClient.post("/job/generate", {
        type: "twitter-credential-scraper",
        worker_id: "213d204a-58f1-4b2c-9039-7869f634d99c",
        arguments: {
          count: maxResults,
          type: "getforyoutweets",
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
      // If the status is 404, the job is likely still processing
      if (error.response?.status === 404) {
        throw new Error(`Job is still processing: Status 404`);
      }
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
      const jobType = process.env.JOB_TYPE || "searchbyquery";
      console.log(`Generating Twitter job with type: ${jobType}...`);

      let sig;
      if (jobType === "hometweets") {
        sig = await this.generateHomeTweetsJob(maxResults);
      } else if (jobType === "foryoutweets") {
        sig = await this.generateForYouTweetsJob(maxResults);
      } else {
        sig = await this.generateTwitterJob(query, maxResults);
      }
      console.log(`Generated job signature: ${sig.substring(0, 20)}...`);

      console.log("Adding Twitter job...");
      const jobUuid = await this.addTelemetryJob(sig);
      console.log(`Added job with UUID: ${jobUuid}`);

      // Track job progress with the new method
      const maxWaitTimeMs = delay * maxRetries;
      console.log(`Tracking job ${jobUuid} progress (max wait time: ${maxWaitTimeMs}ms)...`);
      const progressResult = await this.trackJobProgress(jobUuid, maxWaitTimeMs, 2000);

      // Log progress information
      console.log(`Job progress: ${progressResult.complete ? "Complete" : "Incomplete"}`);
      console.log(`Attempts: ${progressResult.attempts}, Time: ${progressResult.elapsedTimeMs}ms`);

      let result: any;

      if (progressResult.complete) {
        // If job completed, get the result
        try {
          console.log("Returning Twitter job result...");
          result = await this.returnTelemetryJob(sig, progressResult.status);
          console.log(`Twitter job result received`);

          // Count tweets in the result
          const tweetCount = this.countTweets(result);

          return {
            success: true,
            result,
            metadata: {
              ...(jobType === "searchbyquery" ? { query } : {}),
              maxResults,
              workerUrl: this.teeWorkerAddress,
              tweetCount,
              jobType,
              timing: {
                executedAt: new Date().toISOString(),
                responseTimeMs: progressResult.elapsedTimeMs,
              },
            },
          };
        } catch (e: any) {
          console.error(`Error returning Twitter job result: ${e.message}`);
          return {
            success: false,
            error: e.message || "Error retrieving results",
            metadata: {
              ...(jobType === "searchbyquery" ? { query } : {}),
              maxResults,
              workerUrl: this.teeWorkerAddress,
              jobType,
              timing: {
                executedAt: new Date().toISOString(),
                responseTimeMs: progressResult.elapsedTimeMs,
              },
              jobStatus: {
                complete: progressResult.complete,
                attempts: progressResult.attempts,
                jobId: jobUuid,
              },
            },
          };
        }
      } else {
        // Job didn't complete in time, but we have tracking info
        return {
          success: false,
          error: `Job not completed in time: ${progressResult.status}`,
          metadata: {
            ...(jobType === "searchbyquery" ? { query } : {}),
            maxResults,
            workerUrl: this.teeWorkerAddress,
            jobType,
            timing: {
              executedAt: new Date().toISOString(),
              responseTimeMs: progressResult.elapsedTimeMs,
            },
            jobStatus: {
              complete: false,
              attempts: progressResult.attempts,
              jobId: jobUuid,
              status: progressResult.status,
            },
          },
        };
      }
    } catch (e: any) {
      const jobType = process.env.JOB_TYPE || "searchbyquery";
      console.error(`Twitter ${jobType} job sequence failed: ${e.message}`);
      return {
        success: false,
        error: e.message || "Twitter sequence failed",
        metadata: {
          ...(jobType === "searchbyquery" ? { query } : {}),
          maxResults,
          workerUrl: this.teeWorkerAddress,
          tweetCount: 0,
          jobType,
          timing: {
            executedAt: new Date().toISOString(),
          },
        },
      };
    }
  }

  /**
   * Track job progress with progressive backoff
   * Returns job status when complete or partial progress information
   */
  async trackJobProgress(
    jobUuid: string,
    maxWaitTimeMs: number = 60000,
    initialPollIntervalMs: number = 2000
  ): Promise<{ complete: boolean; status: string; attempts: number; elapsedTimeMs: number }> {
    let pollIntervalMs = initialPollIntervalMs;
    let attempts = 0;
    let statusSig = "";
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTimeMs) {
      attempts++;
      try {
        statusSig = await this.checkTelemetryJob(jobUuid);
        // If we get here, the job is complete
        return {
          complete: true,
          status: statusSig,
          attempts,
          elapsedTimeMs: Date.now() - startTime,
        };
      } catch (error: any) {
        const elapsedTimeMs = Date.now() - startTime;

        // If we're approaching the max wait time, return what we have
        if (elapsedTimeMs + pollIntervalMs >= maxWaitTimeMs) {
          return {
            complete: false,
            status: error.message || "Unknown error",
            attempts,
            elapsedTimeMs,
          };
        }

        // If this is a "job is still processing" error (404), we'll keep polling
        if (error.message.includes("Job is still processing")) {
          console.log(
            `Job ${jobUuid} still processing (attempt ${attempts}). Polling again in ${pollIntervalMs}ms...`
          );
          await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
          // Implement progressive backoff (up to 10 seconds between polls)
          pollIntervalMs = Math.min(pollIntervalMs * 1.5, 10000);
        } else {
          // For other errors, we'll stop and return the error
          return {
            complete: false,
            status: `Error: ${error.message}`,
            attempts,
            elapsedTimeMs,
          };
        }
      }
    }

    // If we get here, we've timed out
    return {
      complete: false,
      status: "Timed out waiting for job completion",
      attempts,
      elapsedTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Execute a complete Home Tweets sequence
   */
  async executeHomeTwitterSequence(
    maxResults: number,
    maxRetries: number = 3,
    delay: number = 5000
  ): Promise<JobResponse> {
    try {
      console.log("Generating Home Tweets job...");
      const sig = await this.generateHomeTweetsJob(maxResults);
      console.log(`Generated job signature: ${sig.substring(0, 20)}...`);

      console.log("Adding Home Tweets job...");
      const jobUuid = await this.addTelemetryJob(sig);
      console.log(`Added job with UUID: ${jobUuid}`);

      // Track job progress with the new method
      const maxWaitTimeMs = delay * maxRetries;
      console.log(`Tracking job ${jobUuid} progress (max wait time: ${maxWaitTimeMs}ms)...`);
      const progressResult = await this.trackJobProgress(jobUuid, maxWaitTimeMs, 2000);

      // Log progress information
      console.log(`Job progress: ${progressResult.complete ? "Complete" : "Incomplete"}`);
      console.log(`Attempts: ${progressResult.attempts}, Time: ${progressResult.elapsedTimeMs}ms`);

      let result: any;

      if (progressResult.complete) {
        // If job completed, get the result
        try {
          console.log("Returning Home Tweets job result...");
          result = await this.returnTelemetryJob(sig, progressResult.status);
          console.log(`Home Tweets job result received`);

          // Count tweets in the result
          const tweetCount = this.countTweets(result);

          return {
            success: true,
            result,
            metadata: {
              maxResults,
              workerUrl: this.teeWorkerAddress,
              tweetCount,
              jobType: "hometweets",
              timing: {
                executedAt: new Date().toISOString(),
                responseTimeMs: progressResult.elapsedTimeMs,
              },
            },
          };
        } catch (e: any) {
          console.error(`Error returning Home Tweets job result: ${e.message}`);
          return {
            success: false,
            error: e.message || "Error retrieving results",
            metadata: {
              maxResults,
              workerUrl: this.teeWorkerAddress,
              jobType: "hometweets",
              timing: {
                executedAt: new Date().toISOString(),
                responseTimeMs: progressResult.elapsedTimeMs,
              },
              jobStatus: {
                complete: progressResult.complete,
                attempts: progressResult.attempts,
                jobId: jobUuid,
              },
            },
          };
        }
      } else {
        // Job didn't complete in time, but we have tracking info
        return {
          success: false,
          error: `Job not completed in time: ${progressResult.status}`,
          metadata: {
            maxResults,
            workerUrl: this.teeWorkerAddress,
            jobType: "hometweets",
            timing: {
              executedAt: new Date().toISOString(),
              responseTimeMs: progressResult.elapsedTimeMs,
            },
            jobStatus: {
              complete: false,
              attempts: progressResult.attempts,
              jobId: jobUuid,
              status: progressResult.status,
            },
          },
        };
      }
    } catch (e: any) {
      console.error(`Home Tweets sequence failed: ${e.message}`);
      return {
        success: false,
        error: e.message || "Home Tweets sequence failed",
        metadata: {
          maxResults,
          workerUrl: this.teeWorkerAddress,
          tweetCount: 0,
          jobType: "hometweets",
          timing: {
            executedAt: new Date().toISOString(),
          },
        },
      };
    }
  }
}
