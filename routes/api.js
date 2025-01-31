const express = require("express");
const mongoFunctions = require("../helpers/mongo_functions");
const router = express.Router();

const functions = require("../helpers/functions");

const redisFunctions = require("../helpers/redis_functions");

const jwt = require("jsonwebtoken");
const { google } = require("googleapis");
const validations = require("../helpers/validations");
const rateLimit = require("../helpers/rate_limiter");
const { Auth } = require("../middlewares/auth");
const user_agent_parser = require("ua-parser-js");

const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  "https://url-shortener-app-zv5u.onrender.com/api/oauth_callback"
);
//-------------------Google signin-----------
/**
 * @swagger
 * /api/social_login:
 *   post:
 *     summary: Generate Google OAuth2 login URL
 *     description: Returns a Google authentication URL to initiate OAuth2 login.A link will be generated in the response..
 *                  -Copy that link and paste it in the browser..You will redirect to the google sign in form..Continue with the steps and you will redirect back to the swagger ui after completion of signup process with google.
 *                  -After redirecting,you will get token in the query params use that token later to access protected routes.
 *
 *     tags:
 *       - Authentication
 *     responses:
 *       200:
 *         description: Successfully generated Google OAuth2 login URL.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: string
 *                   description: Google authentication URL.
 *                   example: "https://accounts.google.com/o/oauth2/auth?client_id=..."
 *       500:
 *         description: Internal Server Error.
 */

router.post("/social_login", async (req, res) => {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: [
      "https://www.googleapis.com/auth/userinfo.profile",
      "https://www.googleapis.com/auth/userinfo.email",
    ],
  });
  return res.status(200).send({ data: authUrl });
});
//----------------callback route to redirect to our website after successfully signed up-------------------------

/**
 * @swagger
 * /api/oauth_callback:
 *   get:
 *     summary: Google Login Callback (Sign Up / Sign In)
 *     description: |
 *       This is the callback route for Google Login.
 *       - You need not hit this route.Google itself hit this callback route and give us token in query params whenever
 *         we paste the link which came as response in the above route
 *       - When a user logs in using Google, they are sent back to this route with a special **code**.
 *       - The server uses this code to get the user's Google profile (name, email, etc.).
 *       - If the user is **new**, they are automatically **registered** in the database.
 *       - If the user **already exists**, they are simply **logged in**.
 *       - A **JWT token** is created for the user, which can be used to access protected routes.
 *       - Finally, the user is redirected to the API documentation with the token in the URL.
 *       -Copy the token which is there in the query params with name token after redirection
 *       -Paste it in the Authorisation section to access the protected routes
 *     tags:
 *       - Authentication
 *     responses:
 *       302:
 *         description: |
 *           Login or registration successful!
 *           The user is redirected to the API documentation with a JWT token.
 *         headers:
 *           Location:
 *             schema:
 *               type: string
 *               example: "https://url-shortener-app-zv5u.onrender.com/api-docs/?token=your-jwt-token"
 *       400:
 *         description: |
 *           Something went wrong! The code may be expired or invalid.
 *           Try logging in again.
 *       500:
 *         description: |
 *           Internal Server Error!
 *           Something went wrong on our end. Please try again later or contact support.
 *         content:
 *           application/json:
 *             example:
 *               message: "Internal Server Error"
 */

router.get("/oauth_callback", async (req, res) => {
  console.log("query --->", req.query);
  const { code } = req.query;
  const { tokens } = await oauth2Client.getToken(code);
  console.log("tokens--------->", tokens);
  if (tokens) {
    oauth2Client.setCredentials(tokens);

    // Now use the authenticated client to get user info
    const peopleService = google.people({ version: "v1", auth: oauth2Client });
    if (peopleService) {
      const g_response = await peopleService.people.get({
        resourceName: "people/me",
        personFields: "names,emailAddresses,photos",
      });
      if (g_response) {
        userInfo = g_response.data;
        // console.log("userinfo-->", userInfo);
        let user_data = {
          email: userInfo.emailAddresses[0].value,
          username: userInfo.names[0].givenName + userInfo.names[0].displayName,
          user_id: functions.get_random_string("U", 10),
        };
        console.log(user_data);
        let user = await mongoFunctions.find_one("URL_USERS", {
          email: user_data.email,
        });
        if (!user) {
          await mongoFunctions.create_new_record("URL_USERS", user_data);
        }

        const token = jwt.sign(
          {
            email: user_data.email,
            username: user_data.given_name,
            user_id: user_data.user_id,
          },
          process.env.jwtPrivateKey,
          { expiresIn: "7d" }
        );
        console.log("token--->", token);
        let redirect_url = `https://url-shortener-app-zv5u.onrender.com/api-docs/?token:${token}`;
        return res.redirect(redirect_url);
      }
    }
  }

  return res.status(400).send("Try Again later..!");
});

//---------------------documentation---------------------------

/**
 * @swagger
 * /api/shorten:
 *   post:
 *     summary: Create a short URL
 *     description: Generates a shortened URL for a given long URL. Requires authentication.
 *     tags:
 *       - URL Shortener
 *     security:
 *       - ApiKeyAuth: []  # This should match the security scheme defined in swaggerDefinition
 *     parameters:
 *       - in: header
 *         name: x-auth-token
 *         required: true
 *         schema:
 *           type: string
 *         description: "Authentication token required to access this endpoint"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               longUrl:
 *                 type: string
 *                 description: The long URL to shorten.
 *                 example: "https://example.com/some-long-url"
 *               customAlias:
 *                 type: string
 *                 description: (Optional) Custom alias for the short URL.
 *                 example: "my-custom-alias"
 *               topic:
 *                 type: string
 *                 description: (Optional) Topic or category for the URL.
 *                 example: "Tech"
 *     responses:
 *       200:
 *         description: Shortened URL created successfully.
 *       400:
 *         description: Validation error (e.g., missing required fields).
 *       401:
 *         description: Unauthorized - User authentication required.
 *       500:
 *         description: Internal Server Error.
 */

//route to create short urls by user

router.post("/shorten", Auth, rateLimit(60, 60), async (req, res) => {
  let data = req.body;

  // Validate data
  const { error } = validations.create_shorten_url(data);
  if (error) return res.status(400).send(error.details[0].message);

  let findShort = await mongoFunctions.find_one("ANALYTICS", {
    short_url: data.customAlias,
  });

  if (findShort) {
    return res.status(400).send("This Custom Alias Is Already Exists");
  }
  let analytics_object = {
    user_id: req.user.user_id,
    short_url: data.customAlias ? data.customAlias : functions.shortenUrl(),
    long_url: data.longUrl,
    topic: data.topic ? data.topic : "",
    createdAt: new Date(),
  };

  await mongoFunctions.create_new_record("ANALYTICS", analytics_object);

  await redisFunctions.update_redis("ANALYTICS", analytics_object);
  return res.status(200).send({
    message: "Created Shorten Url Successfully",
    data: {
      short_url: analytics_object.short_url,
      createdAt: analytics_object.createdAt,
    },
  });
});
/**
 * @swagger
 * /api/shorten/{alias}:
 *   get:
 *     summary: Redirect to original URL based on short URL alias
 *     description: |
 *       This endpoint allows you to access the original long URL by using a short URL alias.
 *       - The alias is used to find the shortened URL in the database.
 *       - The number of clicks for the alias is tracked, and the user's device and OS information are logged for analytics.
 *       - This route also tracks the unique clicks per user, device, and operating system (OS).
 *       - Here redirecting to the original url is not supporting..But I have tested it by integrating with frontend ..The redirection is successfully done and properly working..Here it is not redirecting from swagger UI..
 *     tags:
 *       - URL Shortener
 *     security:
 *       - ApiKeyAuth: []  # This should match the security scheme defined in swaggerDefinition
 *     parameters:
 *       - in: path
 *         name: alias
 *         required: true
 *         description: The alias of the shortened URL.
 *         schema:
 *           type: string
 *           example: "my-custom-alias"
 *     responses:
 *       200:
 *         description: |
 *           Redirects the user to the original long URL. The number of clicks is incremented in the analytics database.
 *         content:
 *           application/json:
 *             example:
 *               message: "Redirecting to the original URL..."
 *       400:
 *         description: |
 *           Bad request. The alias parameter must be provided.
 *         content:
 *           application/json:
 *             example:
 *               message: "Alias Should Be Provided"
 *       401:
 *         description: |
 *           Unauthorized. User needs to be authenticated using a valid Bearer token.
 *       404:
 *         description: |
 *           URL not found. The provided alias does not exist.
 *         content:
 *           application/json:
 *             example:
 *               message: "URL not found"
 *       500:
 *         description: |
 *           Internal server error. Something went wrong while processing the request.
 *         content:
 *           application/json:
 *             example:
 *               message: "Internal Server Error"
 */

//route to redirect to the original long url through alias and store necessary details...

router.get("/shorten/:alias", Auth, rateLimit(60, 60), async (req, res) => {
  try {
    console.log(req.headers);
    const data = req.params.alias;
    if (!data) {
      return res.status(400).send("Alias Should Be Provided");
    }

    const user_agent = req.headers["user-agent"];
    const parsed_user_agent = user_agent_parser(user_agent);
    const { user_id, email } = req.user;

    // Get the current date range (today)
    let today = new Date();
    let startDate = new Date(today.setHours(0, 0, 0, 0)); // Start of today (00:00:00)
    let endDate = new Date(today.setHours(23, 59, 59, 999)); // End of today (23:59:59.999)

    console.log("Start Date:", startDate);
    console.log("End Date:", endDate);

    // Find the analytics document with the alias and matching user clicks date
    const findDate = await mongoFunctions.find("ANALYTICS", {
      short_url: data,
      clicks_by_date: {
        $elemMatch: {
          date: { $gte: startDate, $lte: endDate },
        },
      },
    });
    console.log(findDate);

    if (findDate.length > 0) {
      // If the date exists, increment the clicks count
      await mongoFunctions.find_one_and_update(
        "ANALYTICS",
        {
          short_url: data,
          "clicks_by_date.date": { $gte: startDate, $lte: endDate },
        },
        {
          $inc: { "clicks_by_date.$.clicks_count": 1 },
        },
        { returnDocument: "after" }
      );
    } else {
      // Otherwise, push a new date object with 1 click
      await mongoFunctions.find_one_and_update(
        "ANALYTICS",
        { short_url: data },
        {
          $push: { clicks_by_date: { date: today, clicks_count: 1 } },
        },
        { returnDocument: "after" }
      );
    }

    // If the user already exists, update the unique clicks for OS and Device
    const findUser = await mongoFunctions.find("ANALYTICS", {
      short_url: data,
      users: { $elemMatch: { user_id: user_id } },
    });
    const findOsData = await mongoFunctions.find("ANALYTICS", {
      short_url: data,
      os_type: { $elemMatch: { os_name: parsed_user_agent.os.name } },
    });

    const findDeviceData = await mongoFunctions.find("ANALYTICS", {
      short_url: data,
      device_type: {
        $elemMatch: { device_name: parsed_user_agent.device.name },
      },
    });

    if (findUser.length > 0) {
      // Update OS and Device information if the user exists
      const findOs = await mongoFunctions.find("ANALYTICS", {
        short_url: data,
        users: { $elemMatch: { os_name: parsed_user_agent.os.name } },
      });

      const findDevice = await mongoFunctions.find("ANALYTICS", {
        short_url: data,
        users: {
          $elemMatch: { device_name: parsed_user_agent.device.name },
        },
      });

      // For OS update, use arrayFilters to ensure proper element update
      if (findOs.length === 0 && findOsData.length > 0) {
        await mongoFunctions.find_one_and_update(
          "ANALYTICS",
          { short_url: data },
          {
            $inc: { "os_type.$[elem].unique_clicks": 1 },
            $set: { "os_type.$[elem].os_name": parsed_user_agent.os.name },
          },
          {
            arrayFilters: [{ "elem.os_name": parsed_user_agent.os.name }],
            returnDocument: "after",
          }
        );
      } else {
        // If OS doesn't exist, push a new object to the os_type array
        await mongoFunctions.find_one_and_update(
          "ANALYTICS",
          { short_url: data },
          {
            $push: {
              os_type: {
                os_name: parsed_user_agent.os.name,
                unique_clicks: 1,
                unique_users: 1,
              },
            },
          },
          { returnDocument: "after" }
        );
      }

      // For Device update, ensure unique clicks are incremented or new device is added
      if (findDevice.length === 0 && findDeviceData.length > 0) {
        await mongoFunctions.find_one_and_update(
          "ANALYTICS",
          { short_url: data },
          {
            $inc: { "device_type.$[elem].unique_clicks": 1 },
            $set: {
              "device_type.$[elem].device_name": parsed_user_agent.device.name,
            },
          },
          {
            arrayFilters: [
              { "elem.device_name": parsed_user_agent.device.name },
            ],
            returnDocument: "after",
          }
        );
      } else {
        await mongoFunctions.find_one_and_update(
          "ANALYTICS",
          { short_url: data },
          {
            $push: {
              device_type: {
                device_name: parsed_user_agent.device.name,
                unique_clicks: 1,
                unique_users: 1,
              },
            },
          },
          { returnDocument: "after" }
        );
      }
    }

    // If the user does not exist, create a new user entry and increment unique users
    if (findUser.length < 1) {
      console.log("New user detected, adding details.");
      if (findOsData.length > 0) {
        await mongoFunctions.find_one_and_update(
          "ANALYTICS",
          { short_url: data },
          {
            $inc: {
              "os_type.$[elem].unique_clicks": 1,

              "os_type.$[elem].unique_users": 1,
            },
            $set: { "os_type.$[elem].os_name": parsed_user_agent.os.name },
          },
          {
            arrayFilters: [{ "elem.os_name": parsed_user_agent.os.name }],
            returnDocument: "after",
          }
        );
      } else {
        // If OS doesn't exist, push a new object to the os_type array
        await mongoFunctions.find_one_and_update(
          "ANALYTICS",
          { short_url: data },
          {
            $push: {
              os_type: {
                os_name: parsed_user_agent.os.name,
                unique_clicks: 1,
                unique_users: 1,
              },
            },
          },
          { returnDocument: "after" }
        );
      }
      if (findDeviceData.length > 0) {
        await mongoFunctions.find_one_and_update(
          "ANALYTICS",
          { short_url: data },
          {
            $inc: {
              "device_type.$[elem].unique_clicks": 1,
              "device_type.$[elem].unique_users": 1,
            },
            $set: {
              "device_type.$[elem].device_name": parsed_user_agent.device.name,
            },
          },
          {
            arrayFilters: [
              { "elem.device_name": parsed_user_agent.device.name },
            ],
            returnDocument: "after",
          }
        );
      } else {
        await mongoFunctions.find_one_and_update(
          "ANALYTICS",
          { short_url: data },
          {
            $push: {
              device_type: {
                device_name: parsed_user_agent.device.name,
                unique_clicks: 1,
                unique_users: 1,
              },
            },
          },
          { returnDocument: "after" }
        );
      }
      const update = await mongoFunctions.find_one_and_update(
        "ANALYTICS",
        { short_url: data },
        {
          $inc: { unique_users: 1 },
          $push: {
            users: {
              user_id: user_id,
              username: email,
              os_name: parsed_user_agent.os.name,
              device_name: parsed_user_agent.device.vendor,
            },
          },
        },
        {},
        { returnDocument: "after" } // Corrected options parameter
      );
    }

    // Find the updated analytics data for the given short URL
    const url = await mongoFunctions.find_one_and_update(
      "ANALYTICS",
      { short_url: data },
      {
        $inc: { total_clicks: 1 },
      },
      {},
      { returnDocument: "after" } // Corrected options parameter
    );

    console.log(url);
    await redisFunctions.update_redis("ANALYTICS", url);

    if (!url) {
      return res.status(404).send("URL not found");
    }

    return res.status(200).redirect(url.long_url);
  } catch (error) {
    console.error("Error occurred while processing request:", error);
    return res.status(500).send("Internal Server Error");
  }
});

/**
 * @swagger
 * /api/analytics/{alias}:
 *   get:
 *     summary: Get analytics for a specific short URL alias
 *     description: |
 *       This endpoint retrieves analytics data for a given short URL alias.
 *       - The alias is used to fetch the analytics data, including click counts and other statistics.
 *       - If no data is found for the alias, an appropriate error message is returned.
 *     tags:
 *       - URL Shortener
 *     parameters:
 *       - in: path
 *         name: alias
 *         required: true
 *         description: The alias of the shortened URL whose analytics you want to retrieve.
 *         schema:
 *           type: string
 *           example: "my-custom-alias"
 *     responses:
 *       200:
 *         description: |
 *           Successfully fetched analytics data for the given alias.
 *           Returns a detailed report of clicks, users, devices, and other analytics.
 *         content:
 *           application/json:
 *             example:
 *               short_url: "https://short.ly/my-custom-alias"
 *               total_clicks: 7
 *               unique_users: 7
 *               clicks_by_date: []
 *               os_type:
 *                 - os_name: "Windows"
 *                   unique_clicks: 4
 *                   unique_users: 3
 *                 - os_name: "MacOS"
 *                   unique_clicks: 2
 *                   unique_users: 2
 *               device_type:
 *                 - device_name: "Desktop"
 *                   unique_clicks: 5
 *                   unique_users: 4
 *                 - device_name: "Mobile"
 *                   unique_clicks: 2
 *                   unique_users: 2
 *       400:
 *         description: |
 *           Bad request. The alias parameter must be provided in the path.
 *         content:
 *           application/json:
 *             example:
 *               message: "Alias Should Be Provided"
 *       404:
 *         description: |
 *           URL not found. The provided alias does not exist in the analytics database.
 *         content:
 *           application/json:
 *             example:
 *               message: "URL not found"
 *       500:
 *         description: |
 *           Internal server error. Something went wrong while processing the request.
 *         content:
 *           application/json:
 *             example:
 *               message: "Internal Server Error"
 */

//get analytics based on alias
router.get("/analytics/alias/:alias", rateLimit(60, 60), async (req, res) => {
  try {
    const data = req.params.alias;

    console.log(`Alias: ${data}`);

    if (!data) {
      return res.status(400).send("Alias Should Be Provided");
    }

    // Match the alias
    let alias = await mongoFunctions.find_one("ANALYTICS", {
      short_url: data,
    });

    if (!alias) {
      return res.status(404).send("Alias not found");
    }

    console.log(alias);

    return res.status(200).send(alias);
  } catch (error) {
    console.error("Error fetching alias analytics:", error);
    return res.status(500).send("Internal Server Error");
  }
});

/**
 * @swagger
 * /api/analytics/{topic}:
 *   get:
 *     summary: Get analytics for a specific topic
 *     description: |
 *       This endpoint retrieves analytics data for a specific topic associated with a short URL.
 *       - The topic parameter is used to fetch the analytics data related to a specific category or subject of URLs.
 *       - If no data is found for the given topic, an empty result will be returned.
 *     tags:
 *       - URL Shortener
 *     parameters:
 *       - in: path
 *         name: topic
 *         required: true
 *         description: The topic of the shortened URLs whose analytics you want to retrieve.
 *         schema:
 *           type: string
 *           example: "Tech"
 *     responses:
 *       200:
 *         description: |
 *           Successfully fetched analytics data for the given topic.
 *           Returns detailed analytics, including total clicks, unique users, and other statistics related to the topic.
 *         content:
 *           application/json:
 *             example:
 *               totalClicks: 7
 *               uniqueUsers: 7
 *               clicksByDate: []
 *               urls:
 *                 - shortUrl: "my-custom-alias"
 *                   totalClicks: 4
 *                   uniqueUsers: 4
 *                 - shortUrl: "my-custom-alias"
 *                   totalClicks: 0
 *                   uniqueUsers: 0
 *                 - shortUrl: "my-custom-alias"
 *                   totalClicks: 0
 *                   uniqueUsers: 0
 *                 - shortUrl: "my-custom"
 *                   totalClicks: 3
 *                   uniqueUsers: 3
 *                 - shortUrl: "my-custom"
 *                   totalClicks: 0
 *                   uniqueUsers: 0
 *       400:
 *         description: |
 *           Bad request. The topic parameter must be provided in the path.
 *         content:
 *           application/json:
 *             example:
 *               message: "Topic should be provided"
 *       404:
 *         description: |
 *           Topic not found. The provided topic does not exist in the analytics database.
 *         content:
 *           application/json:
 *             example:
 *               message: "Topic not found"
 *       500:
 *         description: |
 *           Internal server error. Something went wrong while processing the request.
 *         content:
 *           application/json:
 *             example:
 *               message: "Internal Server Error"
 */

//get analytics based on topics
router.get("/analytics/topic/:topic", rateLimit(60, 60), async (req, res) => {
  try {
    const data = req.params.topic;

    if (!data) {
      return res.status(400).send("Topic should be provided");
    }
    //find topic in db
    let topic = await mongoFunctions.find("ANALYTICS", {
      topic: data,
    });

    if (!topic) {
      return res.status(404).send("Topic not found");
    }
    // Calculate total clicks by summing up the total_clicks from all URLs
    const total_clicks = topic.reduce(
      (sum, url) => sum + (url.total_clicks || 0),
      0
    );
    const unique_users = topic.reduce(
      (sum, url) => sum + (url.unique_users || 0),
      0
    );

    // Required response
    const response = {
      totalClicks: total_clicks, // Sum of all total_clicks in the URLs array
      uniqueUsers: unique_users, // Unique users for the topic
      clicksByDate: topic.clicks_by_date || [], // Clicks count by date for the topic
      urls:
        topic.map((url) => ({
          shortUrl: url.short_url, // Short URL
          totalClicks: url.total_clicks || 0, // Total clicks for the specific URL
          uniqueUsers: url.unique_users || 0, // Unique users for the specific URL
        })) || [], // Array of URLs under the topic
    };

    return res.status(200).send(response);
  } catch (error) {
    console.error("Error fetching analytics:", error);
    return res.status(500).send("Internal Server Error");
  }
});

/**
 * @swagger
 * /api/analytics/overall:
 *   get:
 *     summary: Get overall analytics for the authenticated user
 *     description: |
 *       This endpoint retrieves the overall analytics data for the currently authenticated user.
 *       - The analytics are fetched from the Redis cache first. If not found, the data will be retrieved from the database and stored in the Redis cache for future use, improving performance by reducing the load on the database.
 *       - The caching mechanism in Redis helps speed up subsequent requests by serving data directly from memory.
 *       - Requires authentication to access this route.
 *     tags:
 *       - URL Shortener
 *     security:
 *       - ApiKeyAuth: []  # This should match the security scheme defined in swaggerDefinition
 *     responses:
 *       200:
 *         description: |
 *           Successfully fetched the overall analytics for the authenticated user.
 *           Returns detailed analytics data, including total clicks, unique users, and breakdowns for devices and OS types.
 *           **Caching with Redis**: To improve performance, the system first checks Redis for cached data. If the data is not in Redis (cache miss), it queries the database and then stores the data in Redis for future use.
 *         content:
 *           application/json:
 *             example:
 *               user_id: "U123456789"
 *               total_urls: 5
 *               total_clicks: 1000
 *               unique_users: 900
 *               clicks_by_date:
 *                 - date: "2025-01-28"
 *                   clicks_count: 300
 *                 - date: "2025-01-29"
 *                   clicks_count: 400
 *                 - date: "2025-01-30"
 *                   clicks_count: 300
 *               os_type:
 *                 - os_name: "Windows"
 *                   unique_clicks: 450
 *                   unique_users: 400
 *                 - os_name: "MacOS"
 *                   unique_clicks: 350
 *                   unique_users: 300
 *               device_type:
 *                 - device_name: "Desktop"
 *                   unique_clicks: 700
 *                   unique_users: 650
 *                 - device_name: "Mobile"
 *                   unique_clicks: 300
 *                   unique_users: 250
 *       401:
 *         description: Unauthorized - User authentication is required to access this data.
 *         content:
 *           application/json:
 *             example:
 *               message: "Unauthorized"
 *       500:
 *         description: |
 *           Internal server error. Something went wrong while processing the request.
 *         content:
 *           application/json:
 *             example:
 *               message: "Internal Server Error"
 */

//get all analytics
router.get("/analytics/overall", Auth, rateLimit(60, 60), async (req, res) => {
  console.log("Overall analytics route hit");

  try {
    //Get data from redis for better performance
    let overall_data = await redisFunctions.redisGet(
      "URL_ANALYTICS",
      req.user.user_id,
      true
    );

    //Handle the case if no data or data cleaned up from redis by any chance...get data from db

    if (!overall_data) {
      overall_data = await mongoFunctions.find(
        "ANALYTICS",
        {
          user_id: req.user.user_id,
        },
        {},
        {},
        {
          user_id: 1,
          total_clicks: 1,
          unique_users: 1,
          os_type: 1,
          device_type: 1,
          clicks_by_date: 1,
        }
      );
    }
    if (!Array.isArray(overall_data)) {
      overall_data = [overall_data]; // Wrap it in an array if it's not already
    }
    overall_data = overall_data.map((item) => ({
      ...item,
      total_urls: overall_data.length, // Add total URLs count to each entry
    }));

    return res.status(200).send(overall_data);
  } catch (error) {
    console.error("Error fetching analytics:", error);
    return res.status(500).json({ message: "Internal Server Error" });
  }
});

module.exports = router;
