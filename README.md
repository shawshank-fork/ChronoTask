# ChronoTask ⏱️

ChronoTask is a secure, light-weight background job scheduler backend API. Built with Node.js, Express, and SQLite, it allows developers to schedule delayed one-off HTTP callbacks or recurring interval-based HTTP requests.

The system features a continuous background worker queue with crash recovery, exponential backoff retries, and ownership-based multi-user isolation.

---

## 🚀 Key Features

*   **🔒 Secure authentication & user isolation**: Login & registration via JWT and `bcrypt` password hashing. Every scheduled job is locked to the user who created it.
*   **📧 Input normalization**: Automatically normalizes email credentials (case-insensitive & whitespace trimmed) to prevent duplicate accounts and login issues.
*   **🛠️ Robust CRUD endpoints**: Create, view, list, pause, resume, and cancel/delete jobs. Deleting a job automatically cleans up its execution logs using database cascade triggers.
*   **🔄 Custom Background Worker**: Polling scheduler checks for due jobs every 5 seconds and executes HTTP requests in parallel using native `Promise.allSettled`.
*   **🛡️ Double-Execution Prevention**: Atomically locks jobs by setting status to `running` right before firing requests, ensuring multiple execution ticks don't overlap.
*   **🔁 Fault Tolerance & Exponential Backoff**: Automatically handles failed HTTP calls (network issues or HTTP codes >= 400). It retries with increasing delay intervals: `10 * 2^failure_count` seconds. Jobs are marked as `failed` permanently after 5 failed attempts.
*   **🧹 Startup Crash Recovery**: Resets any jobs stuck in `running` status back to `pending` on server reboot.
*   **💾 Database Protection**: Parses header templates safely via `try/catch` and slices response bodies to a maximum of 5,000 characters to prevent SQLite bloat.

---

## 🛠️ Codebase Structure

```
ChronoTask/
├── src/
│   ├── db.js             # Initialises SQLite database and schemas
│   ├── server.js         # Entry point for Express server & worker start
│   ├── worker.js         # Core background polling loop & retry engine
│   ├── middleware/
│   │   └── auth.js       # JWT validation middleware
│   └── routes/
│       ├── auth.js       # Registration & login routers
│       └── jobs.js       # Job scheduling, log view, and state controls
├── .env                  # Configuration variables
├── package.json          # Node dependencies & scripts
└── README.md             # Project documentation
```

---

## ⚙️ Installation & Setup

1.  **Clone and navigate to the project directory**:
    ```bash
    cd ChronoTask
    ```
2.  **Install dependencies**:
    ```bash
    npm install
    ```
3.  **Configure environment variables**:
    Create a `.env` file in the root folder with the following contents:
    ```env
    PORT=3000
    JWT_SECRET=super_secret_chronotask_key_123!
    DATABASE_URL=chronotask.db
    ```
4.  **Run the application**:
    - For production:
      ```bash
      npm start
      ```
    - For development with auto-reload:
      ```bash
      npm run dev
      ```

---

## 📡 API Endpoints Reference

### 🔑 Authentication (`/api/auth`)

#### 1. Register User
*   **POST** `/api/auth/register`
*   **Body**:
    ```json
    {
      "email": "user@example.com",
      "password": "yourpassword123"
    }
    ```
*   **Response (201 Created)**:
    ```json
    {
      "message": "User registered successfully",
      "userId": 1
    }
    ```

#### 2. Login User
*   **POST** `/api/auth/login`
*   **Body**:
    ```json
    {
      "email": "user@example.com",
      "password": "yourpassword123"
    }
    ```
*   **Response (200 OK)**:
    ```json
    {
      "message": "Login Successfull",
      "token": "eyJhbGciOiJIUzI1NiIsIn..."
    }
    ```

---

### ⏱️ Job Management (`/api/jobs`)
*Note: All `/api/jobs` endpoints require a `Bearer <token>` in the `Authorization` header.*

#### 3. Schedule a Job
*   **POST** `/api/jobs`
*   **Body**:
    ```json
    {
      "name": "Send Webhook Trigger",
      "url": "https://httpbin.org/post",
      "method": "POST",
      "schedule_type": "interval",
      "schedule_value": 30,
      "payload": { "event": "invoice_paid" }
    }
    ```
*   **Response (201 Created)**:
    ```json
    {
      "message": "job scheduled successfully",
      "job": {
        "id": 1,
        "name": "Send Webhook Trigger",
        "url": "https://httpbin.org/post",
        "method": "POST",
        "schedule_type": "interval",
        "schedule_value": 30,
        "next_run_at": 1782221234567,
        "status": "pending"
      }
    }
    ```

#### 4. List User Jobs
*   **GET** `/api/jobs`
*   **Response (200 OK)**: Returns list of scheduled jobs belonging to the authenticated user.

#### 5. View Job Logs
*   **GET** `/api/jobs/:id/logs`
*   **Response (200 OK)**: Returns chronological list of execution attempts, timestamps, status codes, response sizes, and errors.

#### 6. Pause Job
*   **PATCH** `/api/jobs/:id/pause`
*   **Response (200 OK)**: `{"message": "Job paused successfully"}`

#### 7. Resume Job
*   **PATCH** `/api/jobs/:id/resume`
*   **Response (200 OK)**: `{"message": "job resumed successfully", "next_run_at": 1782226789012}`

#### 8. Delete Job
*   **DELETE** `/api/jobs/:id`
*   **Response (200 OK)**: `{"message": "Job deleted successfully"}`

---

## 🛠️ Verification & Testing

You can use HTTP clients like **Thunder Client** or `curl` to test the API.
1.  **Register & Login**: Register a user and sign in to obtain a JWT.
2.  **Schedule**: Schedule a job pointing to `https://httpbin.org/get` as a `once` or `interval` task.
3.  **Logs**: Let the task run in the background. After the scheduled execution time has passed, fetch the logs via `GET /api/jobs/<job-id>/logs` to see the details of the response.
4.  **Testing Retries**: Schedule a job targeting a broken endpoint (e.g. `http://localhost:9999`). Monitor the logs and watch the system retry with exponential delays (`10s`, `20s`, `40s`, `80s`) before failing permanently.
5.  **Secure Isolation**: Log in as a separate user and verify that attempting to access, pause, or delete the first user's job ID returns a `404 Not Found or unauthorized.` error.
