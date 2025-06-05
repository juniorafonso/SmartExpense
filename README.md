# SmartExpense

SmartExpense is a lightweight, multilingual expense management system built with Node.js, Express, and EJS. It helps households or small teams manage monthly and one-time expenses, with support for templates, attachments, and shared access.

## ✨ Features

*   🌍 **Multilingual Interface:** Supports English, Portuguese, and French.
*   💸 **Multiple Currencies:** Configurable support for USD, BRL, EUR, CHF, GBP.
*   📁 **Document Management:** Upload and manage expense documents (PDFs).
*   🧾 **Expense Tracking:** Track both fixed (recurring) and one-time expenses.
*   🗂 **Project Organization:** Group expenses and incomes by project.
*   🧠 **Recurring Expenses:** Automatically suggest recurring expenses for new months based on previous entries.
*   🧩 **Templates:** Create templates for sets of recurring expenses to apply them easily.
*   👥 **User Authentication:** Secure login system with user session handling.
*   ⚙️ **Configuration:** Easily set default language and currency via the settings page.
*   📊 **Dashboard:** Overview of expenses and incomes. (Assumed feature, add if applicable)
*   ➕ **Income Tracking:** Manage income sources and track earnings. (Assumed feature, add if applicable)

## 🚀 Getting Started with Docker

The easiest way to run SmartExpense is using Docker and Docker Compose.

### Prerequisites

*   [Docker](https://docs.docker.com/get-docker/)
*   [Docker Compose](https://docs.docker.com/compose/install/) (Usually included with Docker Desktop)

### Running with Docker Compose

1.  **Clone the Repository (Optional):**
    If you want to customize or build the image yourself, clone the repository. Otherwise, Docker Compose can pull the pre-built image directly.
    ```bash
    git clone https://github.com/juniorafonso/SmartExpense.git
    cd SmartExpense
    ```

2.  **Create `docker-compose.yml`:**
    Create a file named `docker-compose.yml` in your preferred directory with the following content:

    ```yaml
    version: "3.8"
    services:
      smart-expense:
        image: ghcr.io/juniorafonso/smartexpense:latest # Use the pre-built image from GitHub Container Registry
        container_name: smartexpense_app # Optional: Define a specific container name
        ports:
          - "3000:3000" # Map container port 3000 to host port 3000 (change host port if needed)
        volumes:
          # Mount local directories to persist data outside the container
          - ./uploads:/app/uploads # Persists uploaded files
          - ./database:/app/database # Persists the SQLite database file
        environment:
          NODE_ENV: "production" # Recommended for stability and performance
          PORT: "3000" # Internal port the application listens on
          SESSION_SECRET: "YOUR_SUPER_SECRET_KEY_CHANGE_ME" # !!! CHANGE THIS TO A LONG, RANDOM, SECRET STRING !!!
          DATABASE_PATH: "/app/database/smart_expense.db" # Path inside the container for the database file
        restart: always
    ```

3.  **Important:**
    *   Replace `"YOUR_SUPER_SECRET_KEY_CHANGE_ME"` with a strong, unique secret string. You can generate one using a password manager or online generator.
    *   Make sure the local directories `./uploads` and `./database` exist in the same directory as your `docker-compose.yml` file before starting, or Docker might create them as root, causing permission issues.
        ```bash
        mkdir uploads database
        ```

4.  **Start the Application:**
    Run the following command in the directory containing your `docker-compose.yml` file:
    ```bash
    docker-compose up -d
    ```
    The `-d` flag runs the container in detached mode (in the background).

5.  **Access SmartExpense:**
    Open your web browser and navigate to `http://localhost:3000` (or the host port you configured).

### Stopping the Application

```bash
docker-compose down
```

### Updating the Image

To get the latest version of the application:

```bash
# Pull the latest image tag
docker-compose pull

# Recreate the container with the new image
docker-compose up -d --force-recreate
```

## 🔧 Configuration

*   **Session Secret:** Set a strong `SESSION_SECRET` in your `docker-compose.yml` or environment variables.
*   **Database Path:** The `DATABASE_PATH` environment variable defines where the SQLite database file is stored *inside* the container. The volume mapping ensures it's saved to your host machine.
*   **Application Settings:** Default language and currency can be configured within the application's settings page after the initial setup.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request or open an Issue. (Add more details if you have specific contribution guidelines).

## 📄 License

MIT License
