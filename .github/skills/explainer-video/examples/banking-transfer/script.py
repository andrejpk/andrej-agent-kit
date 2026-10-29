"""Fictional same-bank transfer: safe retries, not a production banking design."""

VOICE_NAME = "en-US-Andrew:DragonHDLatestNeural"
LANGUAGE = "en-US"
SPEECH_RATE = "0%"

SEGMENTS = {
    "intro": (
        "Imagine a customer moving one hundred dollars between two accounts at the same bank. "
        "These accounts and amounts are fictional. We are explaining one idea: "
        "a repeated request must not move the money twice."
    ),
    "lost_response": (
        "The bank commits the transfer, but the response is lost on the way back. "
        "The app sees a timeout. A timeout does not tell us whether the transfer failed, "
        "or whether it succeeded and only the reply disappeared."
    ),
    "same_key": (
        "Before sending the first request, the app creates an idempotency key for this transfer. "
        "Every retry of this same instruction uses that same key. "
        "The bank scopes the key to the caller and checks that the account, amount, "
        "and currency still match."
    ),
    "atomic_posting": (
        "For a new instruction, the bank validates authorization and available funds under concurrency control. "
        "It records balanced ledger entries, the idempotency record, and the result in one database transaction. "
        "Either all these changes commit together, or none of them do."
    ),
    "balances": (
        "In this simplified example, the source balance falls from five hundred to four hundred dollars. "
        "The destination rises from two hundred to three hundred. "
        "The bank debits the source deposit liability and credits the destination deposit liability. "
        "The combined customer balance stays at seven hundred dollars."
    ),
    "safe_retry": (
        "Now the reply is lost and the app retries. The bank finds the completed instruction "
        "with the same key and matching details. It returns the saved result. "
        "It does not create another pair of ledger entries."
    ),
    "boundaries": (
        "Concurrent requests must also be coordinated, for example with a unique key and transactional locking. "
        "A reused key with different details is rejected. "
        "The retention window must cover allowed retries; this is not a promise of exactly once network delivery."
    ),
    "takeaway": (
        "The principle is simple: make the financial effect atomic, and make retries safe. "
        "This example covers an internal transfer, not interbank clearing or settlement. "
        "Real systems also need fraud controls, reconciliation, audit trails, and recovery procedures."
    ),
}
