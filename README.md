Deployed render link----->https://url-shortener-app-zv5u.onrender.com
Api docs for our url-shortener-app--------->https://url-shortener-app-zv5u.onrender.com/api-docs

//Instructions to run the project

-->Clone the repositary
--->npm install
---->node app.js

//Overview of the Url-Shortener-Project
Implemented all the mentioned apis in the project...Implemented rate limiters to allow 1 req per 1 second for authenticated apis..this should make our project to secure and save our project from brute foprce attacjs and so many attacks....and added secure google sign in/signup authentication
and proper redirection to our swagger ui[api docs]..
Used mongo db and written mongodb functions in a mongofunctions.js file in helpers folder for reusablity to make code optimised..

and used redis for better performance 
and used required functions for the project which is putted in helpers folder....helpers folder is the main builing block for our project  implemented helmet and compression for security...allowed cors to access project globally...and as a backend developers we never believe the data coming from web so we need to put validations i have putted validations in helpers folder...

