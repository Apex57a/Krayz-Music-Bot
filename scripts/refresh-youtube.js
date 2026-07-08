const { generate } = require('youtube-po-token-generator');

console.log("Generating YouTube PO Token...");
generate().then((result) => {
    console.log("\n=================================");
    console.log("Successfully generated YouTube PO Token!");
    console.log("=================================\n");
    console.log("Visitor Data:", result.visitorData);
    console.log("PO Token:", result.poToken);
    console.log("\nUpdate your Lavalink application.yml with these values if you experience 'Sign in to confirm you're not a bot' errors.");
}).catch((error) => {
    console.error("Failed to generate token:", error);
});
