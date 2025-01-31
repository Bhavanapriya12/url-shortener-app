Deployed Application

**Live URL**: https://url-shortener-app-zv5u.onrender.com

**API Documentation**: https://url-shortener-app-zv5u.onrender.com/api-docs

**Instructions to Run the Project**

**Clone the Repository**

---git clone <repository_url>
---cd url-shortener-app

**Install Dependencies**

---npm install

**Start the Server**

---node app.js

**Overview of the URL Shortener Project**

**---Features Implemented**

API Implementation: All required APIs for URL shortening and analytics are implemented.

**Rate Limiting:**

Authenticated Routes: Custom rate limiter allowing 1 request per second to prevent brute-force attacks.

Global Rate Limiter: Additional security to prevent excessive requests.

Authentication: Secure Google Sign-In/Sign-Up authentication system.

Swagger UI: Complete documentation for API endpoints with request and response structures.

**Database Management:**

MongoDB as the primary database.

MongoDB functions are centralized in helpers/mongoFunctions.js for reusability and optimized code.

Caching: Implemented Redis to improve performance.

Helpers Folder: Contains core functions that support the project efficiently.

**Security Implementations:**

Helmet for securing HTTP headers.

Compression for performance optimization.

CORS enabled for global access.

Validations: Since backend developers do not trust data coming from the web, validations are implemented in helpers/validations.js.

Middlewares: Authentication middleware implemented in middlewares folder.

**Schema Design:**

Users Schema for storing user data.

Analytics Schema for tracking URL analytics.

Route Configuration: Centralized in helpers/routeConfig.js for better route management.

Queue Management: Used Express Queue for handling asynchronous tasks.

URL Redirection: Proper redirection to shortened URLs.

**API Endpoints**

Refer to the Swagger Documentation for a detailed list of endpoints, request formats, and responses.

**Technologies Used**

Node.js with Express.js for backend development

MongoDB for database management

Redis for caching

Swagger UI for API documentation

Google OAuth for authentication

Helmet & Compression for security and performance

Express Rate Limit for security enhancements

Express Queue for optimized request handling
