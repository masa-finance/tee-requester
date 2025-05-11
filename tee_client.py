#!/usr/bin/env python3
import os
import asyncio
import httpx
import logging
from typing import Optional, Dict, Any

# Set up logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


class SimpleTelemetryClient:
    def __init__(self, tee_worker_address: str):
        self.tee_worker_address = tee_worker_address
        logger.info(f"TEE worker address: {self.tee_worker_address}")

    async def generate_twitter_job(self) -> str:
        """Generate a new Twitter job for AI trending."""
        async with httpx.AsyncClient(verify=False) as client:
            response = await client.post(
                f"{self.tee_worker_address}/job/generate",
                headers={"Content-Type": "application/json"},
                json={
                    "type": "twitter-scraper",
                    "arguments": {
                        "max_results": 22,
                        "query": "#AI trending",
                        "type": "searchbyquery",
                    },
                },
            )
            response.raise_for_status()
            signature = response.content.decode("utf-8")
            return signature

    async def add_job(self, sig: str) -> str:
        """Add a job to the TEE worker."""
        # Remove double quotes and backslashes if present
        if sig.startswith('"') and sig.endswith('"'):
            sig = sig[1:-1]
        sig = sig.replace("\\", "")

        async with httpx.AsyncClient(verify=False) as client:
            response = await client.post(
                f"{self.tee_worker_address}/job/add",
                headers={"Content-Type": "application/json"},
                json={"encrypted_job": sig},
            )
            response.raise_for_status()
            json_response = response.json()
            return json_response.get("uid")

    async def check_job(self, job_uuid: str) -> str:
        """Check the status of a job."""
        async with httpx.AsyncClient(verify=False) as client:
            response = await client.get(
                f"{self.tee_worker_address}/job/status/{job_uuid}"
            )
            response.raise_for_status()
            signature = response.content.decode("utf-8")
            return signature

    async def return_job_result(self, sig: str, result_sig: str) -> Dict[str, Any]:
        """Return the result of a job."""
        # Remove quotes and backslashes from signatures
        if result_sig.startswith('"') and result_sig.endswith('"'):
            result_sig = result_sig[1:-1]
        result_sig = result_sig.replace("\\", "")

        if sig.startswith('"') and sig.endswith('"'):
            sig = sig[1:-1]
        sig = sig.replace("\\", "")

        logger.info(f"Submitting result to: {self.tee_worker_address}")
        async with httpx.AsyncClient(verify=False) as client:
            response = await client.post(
                f"{self.tee_worker_address}/job/result",
                headers={"Content-Type": "application/json"},
                json={"encrypted_result": result_sig, "encrypted_request": sig},
            )
            response.raise_for_status()
            return response.json()

    async def execute_twitter_sequence(self) -> Optional[Dict[str, Any]]:
        """Execute the complete Twitter job sequence for AI trending."""
        try:
            logger.info("Generating Twitter job...")
            sig = await self.generate_twitter_job()
            logger.info(
                f"Generated Twitter job signature: {sig[:20]}..."
            )  # Show truncated signature

            logger.info("Adding Twitter job...")
            job_uuid = await self.add_job(sig)
            logger.info(f"Added Twitter job with UUID: {job_uuid}")

            logger.info("Checking Twitter job status...")
            status_sig = await self.check_job(job_uuid)
            logger.info(
                f"Twitter job status signature: {status_sig[:20]}..."
            )  # Show truncated signature

            logger.info("Returning Twitter job result...")
            result = await self.return_job_result(sig, status_sig)
            logger.info(f"Twitter job result: {result}")

            return result
        except Exception as e:
            logger.error(f"Error in Twitter sequence: {e}")
            return None


async def execute_twitter_sequence_for_client(ip, client, telemetry_results):
    """Execute Twitter sequence for a single client."""
    try:
        logger.info(f"Executing Twitter sequence for {ip}")
        result = await client.execute_twitter_sequence()

        telemetry_results[ip]["twitter_sequences"] += 1
        if result:
            telemetry_results[ip]["successful"] += 1
            logger.info(f"Twitter sequence for {ip} completed successfully")
        else:
            telemetry_results[ip]["failed"] += 1
            logger.warning(f"Twitter sequence for {ip} failed")
    except Exception as e:
        telemetry_results[ip]["failed"] += 1
        logger.error(f"Error executing Twitter sequence for {ip}: {e}")


async def main():
    # Get worker URLs from environment
    worker_urls_str = os.environ.get("WORKER_URLS", "").replace(" ", "")

    # Split comma-separated URLs if multiple are provided
    # Handle quoted strings properly
    if worker_urls_str.startswith('"') and worker_urls_str.endswith('"'):
        worker_urls_str = worker_urls_str[1:-1]

    tee_worker_addresses = [
        url.strip() for url in worker_urls_str.split(",") if url.strip()
    ]

    if not tee_worker_addresses:
        logger.error("No worker URLs provided in WORKER_URLS environment variable")
        return

    logger.info(f"Using worker URLs: {tee_worker_addresses}")

    # Dictionary to store telemetry results for each IP
    telemetry_results = {
        ip: {"twitter_sequences": 0, "successful": 0, "failed": 0}
        for ip in tee_worker_addresses
    }

    # Create clients for each address
    clients = {ip: SimpleTelemetryClient(ip) for ip in tee_worker_addresses}

    try:
        # Run Twitter sequences in a loop until interrupted
        logger.info(
            "Starting Twitter sequence loop. Press Ctrl+C to stop and view results."
        )
        sequence_count = 0

        while True:
            sequence_count += 1
            logger.info(f"Running Twitter sequence round {sequence_count}")

            # Create tasks for all clients to run in parallel
            tasks = []
            for ip, client in clients.items():
                task = asyncio.create_task(
                    execute_twitter_sequence_for_client(ip, client, telemetry_results)
                )
                tasks.append(task)

            # Wait for all tasks to complete
            await asyncio.gather(*tasks)

            # Wait before next round
            await asyncio.sleep(5)  # Fixed 5-second delay between requests

    except KeyboardInterrupt:
        logger.info("Twitter sequence loop interrupted by user")

    # Display summary results
    logger.info("\n===== TWITTER QUERY SUMMARY =====")
    for ip, stats in telemetry_results.items():
        success_rate = 0
        if stats["twitter_sequences"] > 0:
            success_rate = (stats["successful"] / stats["twitter_sequences"]) * 100

        logger.info(f"\nNode: {ip}")
        logger.info(f"  Twitter sequences attempted: {stats['twitter_sequences']}")
        logger.info(f"  Successful sequences: {stats['successful']}")
        logger.info(f"  Failed sequences: {stats['failed']}")
        logger.info(f"  Success rate: {success_rate:.2f}%")


if __name__ == "__main__":
    # Set up signal handlers for graceful shutdown
    loop = asyncio.get_event_loop()
    try:
        loop.run_until_complete(main())
    except KeyboardInterrupt:
        logger.info("Script interrupted by user")
    finally:
        loop.close()
