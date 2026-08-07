# Cloud-Based User Management API

A robust Node.js RESTful API built with Fastify, featuring secure authentication, role-based access control (RBAC), and session management. This project implements advanced security patterns for handling user data and credentials.

## Technical Highlights
* **Secure Authentication:** Implemented secure password hashing utilizing `bcrypt` alongside token-based authentication mechanisms.
* **JWT Token Rotation:** Engineered a dual-token system (Access and Refresh tokens) featuring family-based token tracking and revocation to mitigate replay attacks and compromised sessions.
* **Role-Based Access Control:** Leveraged Fastify lifecycle hooks (middleware/decorators) to enforce strict authorization protocols across three privilege tiers: Admin, Authenticated User, and Unauthenticated User.

## Tech Stack
* **Framework:** Fastify (Node.js)
* **Language:** JavaScript / TypeScript
* **Security:** JSON Web Tokens (`@fastify/jwt`), BCrypt
* **Tooling:** ESLint, Prettier, Docker

## Setup and Installation
Ensure you have Node.js and npm installed on your machine.

1. Clone the repository:
   ```bash
   git clone https://github.com/johannavalaragon/user-management-api.git
   cd user-management-api
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
## Usage
To start the development server, run the following command:
```bash
npm start
```
