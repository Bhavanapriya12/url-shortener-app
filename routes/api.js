const express = require("express");
const mongoFunctions = require("../helpers/mongo_functions");
const router = express.Router();

const functions = require("../helpers/functions");

const redisFunctions = require("../helpers/redis_functions");

const jwt = require("jsonwebtoken");
const { google } = require("googleapis");
const validations = require("../helpers/validations");
const { redisInsert } = require("../helpers/redis_functions");
const rateLimit = require("../helpers/rate_limiter");
const { Auth } = require("../middlewares/auth");
const user_agent_parser = require("ua-parser-js");

const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  "http://localhost:8001/api/oauth_callback"
);
//-------------------Google signin-----------
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
        let fe_url = `http://localhost:8001/?token:${token}`;
        return res.redirect(fe_url);
      }
    }
  }

  return res.status(400).send("Try Again later..!");
});

//route to create short urls

router.post("/shorten", rateLimit(60, 60), async (req, res) => {
  let data = req.body;

  // Validate data
  const { error } = validations.create_shorten_url(data);
  if (error) return res.status(400).send(error.details[0].message);

  let analytics_object = {
    short_url: data.customAlias
      ? data.customAlias
      : functions.shortenUrl(data.longUrl),
    long_url: data.longUrl,
    topic: data.topic ? data.topic : "",
    createdAt: new Date(),
  };

  await mongoFunctions.create_new_record("ANALYTICS", analytics_object);
  //   await redisFunctions.redisInsert(analytics_object);
  return res.status(200).send({
    message: "Created Shorten Url Successfully",
    data: analytics_object,
  });
});

//route to redirect to the original long url through alias
router.get("/shorten/:alias", Auth, rateLimit(60, 60), async (req, res) => {
  console.log(req.headers);
  const data = req.params.alias;

  console.log(`Alias: ${data}`);

  if (!data) {
    return res.status(400).send("Alias Should Be Provided");
  }
  const user_agent = req.headers["user-agent"];
  const parsed_user_agent = user_agent_parser(user_agent);
  const current_date = new Date().toISOString().split("T")[0];
  const user_id = req.user.user_id;
  const username = req.user.username;
  console.log(parsed_user_agent.os.name);
  let total_clicks;
  let unique_users;
  let findUser = await mongoFunctions.find("ANALYTICS", {
    users: {
      $elemMatch: {
        user_id: req.user.user_id,
      },
    },
  });
  console.log(findUser.length);
  if (findUser.length > 0) {
    let m = await mongoFunctions.find_one_and_update(
      "ANALYTICS",
      { short_url: data },

      {
        $inc: {
          total_clicks: 1,
        },
      },
      { returnDocument: "after" }
    );
  } else {
    // if os type equal to db os type we should inc unique cicks and unique users in that found obj otherwise we should increment unique clicks and unique users and set os name
    let obj;
    let device_obj;
    let findOs = await mongoFunctions.find("ANALYTICS", {
      os_type: {
        $elemMatch: {
          os_name: parsed_user_agent.os.name,
        },
      },
    });
    let findDevice = await mongoFunctions.find("ANALYTICS", {
      device_type: {
        $elemMatch: {
          device_name: parsed_user_agent.device.name,
        },
      },
    });
    if (findDevice.length > 0) {
      // If os_name exists in os_type array, increment unique_clicks and unique_users
      obj = {
        $inc: {
          "device_type.$.unique_clicks": 1,
          "device_type.$.unique_users": 1,
        },
      };
    } else {
      // If os_name doesn't exist, add a new entry to os_type
      obj = {
        $push: {
          device_type: {
            device_name: parsed_user_agent.device.name,
            unique_clicks: 1,
            unique_users: 1,
          },
        },
      };
    }

    if (findOs.length > 0) {
      // If os_name exists in os_type array, increment unique_clicks and unique_users
      obj = {
        $inc: {
          "os_type.$.unique_clicks": 1,
          "os_type.$.unique_users": 1,
        },
      };
    } else {
      // If os_name doesn't exist, add a new entry to os_type
      obj = {
        $push: {
          os_type: {
            os_name: parsed_user_agent.os.name,
            unique_clicks: 1,
            unique_users: 1,
          },
        },
      };
    }
    let s = await mongoFunctions.find_one_and_update(
      "ANALYTICS",
      { short_url: data },

      {
        $inc: {
          total_clicks: 1,
          unique_users: 1,
        },
        $push: {
          users: {
            user_id: user_id,
            username: username,
            os_name: parsed_user_agent.os.name,
            device_name: parsed_user_agent.device.vendor,
          },
        },
        obj,
      },
      { returnDocument: "after" }
    );
    console.log(s);
  }

  // Retrieve the original URL from the database
  // Retrieve the original URL from the database

  console.log(url);

  // Check if the URL exists in the database
  if (!url) {
    return res.status(404).send("URL not found");
  }

  // Redirect to the original long URL
  return res.status(200).send(url);
});

//get analytics based on topics
router.get("/analytics/:topic", rateLimit(60, 60), async (req, res) => {
  const data = req.params.topic;

  // Log the short URL alias
  console.log(`Alias: ${data}`);

  // Check if alias is provided
  if (!data) {
    return res.status(400).send("Alias Should Be Provided");
  }

  // Retrieve the original URL from the database
  let url = await mongoFunctions.find_one("ANALYTICS", {
    topic: data,
  });

  // Redirect to the original long URL
  return res.redirect(url.long_url);
});
//get analytics based on alias
router.get("/analytics/:alias", rateLimit(60, 60), async (req, res) => {
  const data = req.params.alias;

  // Log the short URL alias
  console.log(`Alias: ${data}`);

  // Check if alias is provided
  if (!data) {
    return res.status(400).send("Alias Should Be Provided");
  }

  // Retrieve the original URL from the database
  let url = await mongoFunctions.find_one_and_update(
    "ANALYTICS",
    { short_url: alias },
    {
      $inc: {
        total_clicks: 1, // Increment total clicks
        "clicks_by_date.$[dateEntry].click_count": 1, // Increment today's click count
        unique_users: {
          $cond: [{ $not: { $in: [user_id, "$users.user_id"] } }, 1, 0],
        }, // Increment unique users if the user is new
        "os_type.$[osEntry].unique_clicks": {
          $cond: [{ $not: { $in: [user_id, "$users.user_id"] } }, 1, 0],
        }, // Increment unique clicks for OS if the user is new
        "device_type.$[deviceEntry].unique_clicks": {
          $cond: [{ $not: { $in: [user_id, "$users.user_id"] } }, 1, 0],
        }, // Increment unique clicks for device if the user is new
      },
      $addToSet: {
        users: { user_id, username }, // Add the user to the array if not already present
      },
      $push: {
        clicks_by_date: {
          $each: [{ date: current_date, click_count: 1 }],
          $position: 0, // Add new date at the beginning
        },
        os_type: {
          os_name: parsed_user_agent.os.name,
          unique_clicks: 1,
        },
        device_type: {
          device_name: parsed_user_agent.device.type,
          unique_clicks: 1,
        },
      },
    },
    {
      arrayFilters: [
        { "dateEntry.date": current_date }, // Match today's date
        { "osEntry.os_name": parsed_user_agent.os.name }, // Match OS name
        { "deviceEntry.device_name": parsed_user_agent.device.type }, // Match device name
      ],
      upsert: true, // Create the document if it doesn't exist
      returnDocument: "after", // Return the updated document
    }
  );
  console.log(url);

  // Check if the URL exists in the database
  if (!url) {
    return res.status(404).send("URL not found");
  }

  // Redirect to the original long URL
  return res.status(200).send(url);
});

//get analytics based on topics
router.get("/analytics/:topic", rateLimit(60, 60), async (req, res) => {
  const data = req.params.topic;

  // Log the short URL alias
  console.log(`Alias: ${data}`);

  // Check if alias is provided
  if (!data) {
    return res.status(400).send("Alias Should Be Provided");
  }

  // Retrieve the original URL from the database
  let url = await mongoFunctions.find_one("ANALYTICS", {
    topic: data,
  });

  // Check if the URL exists in the database
  if (!url) {
    return res.status(404).send("URL not found");
  }

  // Redirect to the original long URL
  return res.status(200).send(url);
});

//get all analytics
router.get("/analytics/overall", rateLimit(60, 60), async (req, res) => {
  const data = req.params.topic;

  // Log the short URL alias
  console.log(`Alias: ${data}`);

  // Check if alias is provided
  if (!data) {
    return res.status(400).send("Alias Should Be Provided");
  }

  // Retrieve the original URL from the database
  let url = await mongoFunctions.find_one("ANALYTICS", {});

  // Check if the URL exists in the database
  if (!url) {
    return res.status(404).send("URL not found");
  }

  // Redirect to the original long URL
  return res.status(200).send(url);
});

module.exports = router;
