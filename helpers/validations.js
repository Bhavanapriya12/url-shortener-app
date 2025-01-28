const Joi = require("joi");

// Define schema for shorten url
function create_shorten_url(data) {
  const schema = Joi.object({
    longUrl: Joi.string().required(),
    customAlias: Joi.string().optional().allow(""),
    topic: Joi.string().optional().allow(""),
  });
  return schema.validate(data);
}
module.exports = {
  create_shorten_url,
};
