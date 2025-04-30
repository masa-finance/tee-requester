package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"

	"github.com/masa-finance/tee-worker/api/types"
	. "github.com/masa-finance/tee-worker/pkg/client"
)

func main() {
	// Get the worker URL from environment variable
	workerURL := os.Getenv("WORKER_URL")

	// Initialize the client
	clientInstance := NewClient(workerURL)

	// Create the job request
	job := types.Job{
		Type: "twitter-scraper",
		Arguments: map[string]interface{}{
			"query":       "#AI",
			"max_results": 10,
		},
	}

	// Get a Job signature
	fmt.Println("Creating job signature...")
	jobSignature, err := clientInstance.CreateJobSignature(job)
	if err != nil {
		log.Fatalf("Error creating job signature: %v", err)
	}

	// Submit the job signature for execution
	fmt.Println("Submitting job...")
	jobResult, err := clientInstance.SubmitJob(jobSignature)
	if err != nil {
		log.Fatalf("Error submitting job: %v", err)
	}

	// Get the job result (decrypted)
	fmt.Println("Getting decrypted job result...")
	result, err := jobResult.GetDecrypted(jobSignature)
	if err != nil {
		log.Fatalf("Error getting decrypted result: %v", err)
	}

	// Print the result as JSON
	resultJSON, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		log.Fatalf("Error marshaling result: %v", err)
	}

	fmt.Println("Job completed successfully!")
	fmt.Println("Result:")
	fmt.Println(string(resultJSON))
}
