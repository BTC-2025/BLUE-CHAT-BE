const { Resend } = require("resend");

// Initialize Resend with API Key from env
const resend = new Resend(process.env.RESEND_API_KEY);

const sendOtpEmail = async (email, otp) => {
    try {
        const { data, error } = await resend.emails.send({
            from: "BlueChat <onboarding@resend.dev>", // Use verified domain or onboarding@resend.dev
            to: [email],
            subject: "Your BlueChat Verification Code",
            html: `
            <div style="font-family: sans-serif; max-width: 500px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 20px; background: #f9f9f9;">
                <h2 style="color: #0088cc; text-align: center;">BlueChat</h2>
                <p style="font-size: 16px; color: #333; text-align: center;">Welcome to BlueChat! Use the verification code below to complete your registration:</p>
                <div style="background: #0088cc; color: white; font-size: 32px; font-weight: bold; text-align: center; padding: 15px; border-radius: 12px; margin: 20px 0; letter-spacing: 5px;">
                    ${otp}
                </div>
                <p style="font-size: 12px; color: #777; text-align: center;">This code will expire in 5 minutes. If you didn't request this, please ignore this email.</p>
                <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
                <p style="font-size: 10px; color: #999; text-align: center;">© 2025 BURJ Tech Consultancy (OPC) Pvt Ltd.</p>
            </div>
        `,
        });

        if (error) {
            console.error("Resend Error:", error);
            return false;
        }

        return true;
    } catch (error) {
        console.error("Critical Mail Error:", error);
        return false;
    }
};

module.exports = { sendOtpEmail };
