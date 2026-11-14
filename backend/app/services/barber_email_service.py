import asyncio
import logging
import os
import re
import ssl

from email.message import EmailMessage
from html import escape
from urllib.parse import urlencode, urlparse

import aiosmtplib


logger = logging.getLogger("kshurak.barber.email")


# ============================================================
# EMAIL CONFIGURATION
# ============================================================

def get_email_config() -> dict:
    required = [
        "SMTP_HOST",
        "SMTP_PORT",
        "SMTP_USERNAME",
        "SMTP_PASSWORD",
        "SMTP_FROM_EMAIL",
        "BARBER_FRONTEND_URL",
    ]

    missing = [
        key for key in required
        if not os.getenv(key)
    ]

    if missing:
        raise RuntimeError(
            "Missing email configuration: "
            + ", ".join(missing)
        )

    port = int(os.environ["SMTP_PORT"])

    if port not in (465, 587):
        raise RuntimeError(
            "SMTP_PORT must be 465 or 587."
        )

    frontend_url = os.environ[
        "BARBER_FRONTEND_URL"
    ].rstrip("/")

    parsed = urlparse(frontend_url)

    if parsed.scheme not in ("http", "https"):
        raise RuntimeError(
            "BARBER_FRONTEND_URL must be a valid URL."
        )

    if not parsed.hostname:
        raise RuntimeError(
            "BARBER_FRONTEND_URL must have a hostname."
        )

    # In production, the frontend URL must use HTTPS.
    if (
        os.getenv("APP_ENV", "development").lower()
        == "production"
        and parsed.scheme != "https"
    ):
        raise RuntimeError(
            "Production frontend URL must use HTTPS."
        )

    return {
        "host": os.environ["SMTP_HOST"],
        "port": port,
        "username": os.environ["SMTP_USERNAME"],
        "password": os.environ["SMTP_PASSWORD"],
        "from_email": os.environ["SMTP_FROM_EMAIL"],
        "from_name": os.getenv(
            "SMTP_FROM_NAME",
            "KSHURAK Team"
        ),
        "frontend_url": frontend_url,
    }


# ============================================================
# SECURE EMAIL DELIVERY
# ============================================================

async def send_email(
    to_email: str,
    subject: str,
    text_body: str,
    html_body: str,
) -> None:
    config = get_email_config()

    message = EmailMessage()

    message["From"] = (
        f'{config["from_name"]} '
        f'<{config["from_email"]}>'
    )

    message["To"] = to_email
    message["Subject"] = subject

    message.set_content(text_body)

    message.add_alternative(
        html_body,
        subtype="html",
    )

    try:
        await aiosmtplib.send(
            message,
            hostname=config["host"],
            port=config["port"],
            username=config["username"],
            password=config["password"],
            use_tls=config["port"] == 465,
            start_tls=config["port"] == 587,
            tls_context=ssl.create_default_context(),
            timeout=20,
        )

        logger.info(
            "KSHURAK email delivered to SMTP server"
        )

    except (aiosmtplib.SMTPException, OSError):
        logger.exception(
            "Unable to send KSHURAK email"
        )

        raise RuntimeError(
            "Email delivery failed."
        ) from None


# ============================================================
# EMAIL TEMPLATE
# ============================================================

def email_template(
    heading: str,
    description: str,
    button_label: str,
    action_url: str,
    footer_message: str,
) -> str:
    safe_heading = escape(heading)
    safe_description = escape(description)
    safe_button = escape(button_label)
    safe_url = escape(action_url, quote=True)
    safe_footer = escape(footer_message)

    return f"""
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport"
            content="width=device-width, initial-scale=1">
    </head>

    <body style="
        margin:0;
        padding:35px 15px;
        background:#070708;
        font-family:Arial,sans-serif;
        color:#FFFFFF;
    ">
      <table role="presentation"
             cellspacing="0"
             cellpadding="0"
             width="100%">
        <tr>
          <td align="center">

            <table role="presentation"
                   width="100%"
                   style="
                     max-width:520px;
                     background:#17181A;
                     border:1px solid #27282C;
                     border-radius:15px;
                   ">
              <tr>
                <td style="padding:35px 30px;">

                  <h2 style="
                      color:#F59E0B;
                      margin:0 0 25px;
                      font-size:25px;
                  ">
                    KSHURAK
                  </h2>

                  <h1 style="
                      margin:0 0 20px;
                      font-size:24px;
                      color:#FFFFFF;
                  ">
                    {safe_heading}
                  </h1>

                  <p style="
                      font-size:15px;
                      line-height:1.8;
                      color:#9E9EA7;
                      margin-bottom:30px;
                  ">
                    {safe_description}
                  </p>

                  <table role="presentation"
                         cellspacing="0"
                         cellpadding="0">
                    <tr>
                      <td bgcolor="#F59E0B"
                          style="
                            border-radius:8px;
                            padding:15px 25px;
                          ">
                        <a href="{safe_url}"
                           style="
                             color:#000000;
                             font-size:15px;
                             font-weight:bold;
                             text-decoration:none;
                           ">
                          {safe_button}
                        </a>
                      </td>
                    </tr>
                  </table>

                  <p style="
                      font-size:12px;
                      line-height:1.7;
                      color:#71717A;
                      margin-top:30px;
                  ">
                    {safe_footer}
                  </p>

                  <hr style="
                      border:0;
                      border-top:1px solid #27282C;
                      margin:25px 0;
                  ">

                  <p style="
                      color:#71717A;
                      font-size:12px;
                      margin:0;
                  ">
                    © KSHURAK. Style. Confidence. You.
                  </p>

                </td>
              </tr>
            </table>

          </td>
        </tr>
      </table>
    </body>
    </html>
    """


# ============================================================
# APPROVAL / ACTIVATION EMAIL
# ============================================================

async def send_barber_activation_email(
    to_email: str,
    username: str,
    raw_token: str,
) -> None:
    config = get_email_config()

    activation_url = (
        f'{config["frontend_url"]}/activate?'
        + urlencode({"token": raw_token})
    )

    heading = "Your Barber Account Has Been Approved!"

    description = (
        f"Hello {username}, your KSHURAK barber "
        "registration has been approved by our team. "
        "Click the button below to activate your account "
        "and get started."
    )

    footer = (
        "This activation link is secure and can be "
        "used only once. If you did not register "
        "with KSHURAK, please ignore this email."
    )

    text_body = (
        f"{heading}\n\n"
        f"{description}\n\n"
        f"Activate your account:\n{activation_url}\n\n"
        f"{footer}"
    )

    html_body = email_template(
        heading=heading,
        description=description,
        button_label="Activate My Account",
        action_url=activation_url,
        footer_message=footer,
    )

    await send_email(
        to_email=to_email,
        subject="KSHURAK Barber Registration Approved",
        text_body=text_body,
        html_body=html_body,
    )


# ============================================================
# FORGOT PASSWORD EMAIL
# ============================================================

async def send_barber_password_reset_email(
    to_email: str,
    username: str,
    raw_token: str,
) -> None:
    config = get_email_config()

    reset_url = (
        f'{config["frontend_url"]}/reset-password?'
        + urlencode({"token": raw_token})
    )

    heading = "Reset Your KSHURAK Password"

    description = (
        f"Hello {username}, we received a request "
        "to reset your KSHURAK barber account password. "
        "Click the button below to set a new password."
    )

    footer = (
        "For your security, this password-reset link "
        "will expire after the period configured by "
        "the backend. If you did not request a password "
        "reset, you can safely ignore this email."
    )

    text_body = (
        f"{heading}\n\n"
        f"{description}\n\n"
        f"Reset your password:\n{reset_url}\n\n"
        f"{footer}"
    )

    html_body = email_template(
        heading=heading,
        description=description,
        button_label="Reset Password",
        action_url=reset_url,
        footer_message=footer,
    )

    await send_email(
        to_email=to_email,
        subject="KSHURAK Password Reset Request",
        text_body=text_body,
        html_body=html_body,
    )


# ============================================================
# BARBER REGISTRATION REJECTION EMAIL
# ============================================================

async def send_barber_rejection_email(
    to_email: str,
    username: str,
    rejection_reason: str,
) -> None:
    """
    Send a rejection notification to the Barber.

    Uses the existing configured Brevo SMTP service.
    No account status or database changes happen here.
    """

    from html import escape

    reason = rejection_reason.strip()

    if not reason:
        raise ValueError(
            "A rejection reason is required."
        )

    heading = "Update on Your KSHURAK Registration"

    subject = "KSHURAK Barber Registration Update"

    text_body = (
        f"Dear {username},\n\n"
        "Thank you for your interest in joining KSHURAK.\n\n"
        "After reviewing your Barber registration, "
        "we regret to inform you that your application "
        "has not been approved at this time.\n\n"
        f"Reason: {reason}\n\n"
        "If you need clarification, please contact "
        "the KSHURAK support team.\n\n"
        "Thank you for your understanding.\n\n"
        "Best regards,\n"
        "KSHURAK Team"
    )

    safe_username = escape(username)
    safe_reason = escape(reason).replace(
        "\n", "<br>"
    )

    html_body = f"""
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport"
            content="width=device-width, initial-scale=1">
    </head>

    <body style="
        margin:0;
        padding:35px 15px;
        background:#070708;
        font-family:Arial,sans-serif;
        color:#FFFFFF;
    ">
      <table role="presentation"
             width="100%"
             cellpadding="0"
             cellspacing="0">
        <tr>
          <td align="center">

            <table role="presentation"
                   width="100%"
                   style="
                     max-width:520px;
                     background:#17181A;
                     border:1px solid #27282C;
                     border-radius:15px;
                   ">
              <tr>
                <td style="padding:35px 30px;">

                  <h2 style="
                      color:#F59E0B;
                      font-size:25px;
                      margin:0 0 25px;
                  ">
                    KSHURAK
                  </h2>

                  <h1 style="
                      color:#FFFFFF;
                      font-size:23px;
                      margin:0 0 20px;
                  ">
                    Registration Status Update
                  </h1>

                  <p style="
                      color:#D4D4D8;
                      font-size:15px;
                      line-height:1.8;
                  ">
                    Dear {safe_username},
                  </p>

                  <p style="
                      color:#A1A1AA;
                      font-size:15px;
                      line-height:1.8;
                  ">
                    Thank you for your interest in
                    becoming a KSHURAK Barber Partner.
                  </p>

                  <p style="
                      color:#A1A1AA;
                      font-size:15px;
                      line-height:1.8;
                  ">
                    After reviewing your application,
                    we regret to inform you that it
                    has not been approved at this time.
                  </p>

                  <div style="
                      background:#24201B;
                      border:1px solid #6B4D22;
                      border-radius:10px;
                      padding:18px;
                      margin:25px 0;
                  ">
                    <p style="
                        color:#F59E0B;
                        font-size:13px;
                        font-weight:bold;
                        margin:0 0 10px;
                    ">
                      REASON FOR REJECTION
                    </p>

                    <p style="
                        color:#FFFFFF;
                        font-size:14px;
                        line-height:1.7;
                        margin:0;
                        overflow-wrap:anywhere;
                    ">
                      {safe_reason}
                    </p>
                  </div>

                  <p style="
                      color:#A1A1AA;
                      font-size:14px;
                      line-height:1.8;
                  ">
                    If you require clarification,
                    please contact our support team.
                  </p>

                  <p style="
                      color:#D4D4D8;
                      font-size:14px;
                      line-height:1.8;
                  ">
                    Best regards,<br>
                    <strong>KSHURAK Team</strong>
                  </p>

                  <hr style="
                      border:0;
                      border-top:1px solid #27282C;
                      margin:25px 0;
                  ">

                  <p style="
                      color:#71717A;
                      font-size:12px;
                  ">
                    KSHURAK — Style. Confidence. You.
                  </p>

                </td>
              </tr>
            </table>

          </td>
        </tr>
      </table>
    </body>
    </html>
    """

    await send_email(
        to_email=to_email,
        subject=subject,
        text_body=text_body,
        html_body=html_body,
    )

    logger.info(
        "Barber rejection email submitted to SMTP server."
    )

# ============================================================
# ADDITIONAL INFORMATION REQUEST EMAIL
# ============================================================

async def send_barber_correction_request_email(
    to_email: str,
    username: str,
    correction_reason: str,
    raw_token: str,
    expiry_minutes: int = 1440,
) -> None:
    """Email a restricted correction link and the Admin's instructions.

    The Admin backend commits the token before invoking this function.
    HTML-escape user/admin-supplied text before rendering.
    """
    reason = correction_reason.strip()
    if not 5 <= len(reason) <= 1000:
        raise ValueError("Correction message must contain 5 to 1000 characters.")

    if not raw_token or not raw_token.strip():
        raise ValueError("A correction access token is required.")
    if expiry_minutes <= 0:
        raise ValueError("Correction token lifetime must be positive.")
    config = get_email_config()
    correction_url = (
        f'{config["frontend_url"]}/correct-registration?'
        + urlencode({"token": raw_token})
    )
    safe_correction_url = escape(correction_url, quote=True)
    safe_username = escape(username)
    safe_reason = escape(reason).replace("\r\n", "\n").replace("\r", "\n")
    safe_reason = safe_reason.replace("\n", "<br>")
    heading = "Additional Information Required"
    subject = "KSHURAK Barber Registration – Additional Information Required"

    text_body = (
        f"Dear {username},\n\n"
        "We have reviewed your KSHURAK Barber registration and "
        "require additional information before we can complete verification.\n\n"
        "INFORMATION REQUESTED BY ADMIN:\n"
        f"{reason}\n\n"
        "Open the secure link below to review and resubmit your registration:\n"
        f"{correction_url}\n\n"
        f"This link expires in {expiry_minutes} minutes and is for your registration only.\n\n"
        "Best regards,\nKSHURAK Team"
    )

    html_body = f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:35px 15px;background:#070708;font-family:Arial,sans-serif;color:#FFFFFF;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="max-width:520px;background:#17181A;border:1px solid #27282C;border-radius:15px;">
        <tr><td style="padding:35px 30px;">
          <h2 style="color:#F59E0B;font-size:25px;margin:0 0 25px;">KSHURAK</h2>
          <h1 style="font-size:23px;color:#FFFFFF;margin:0 0 20px;">{heading}</h1>
          <p style="color:#D4D4D8;font-size:15px;line-height:1.8;">Dear {safe_username},</p>
          <p style="color:#A1A1AA;font-size:15px;line-height:1.8;">
            We have reviewed your Barber registration and require additional information
            before we can complete verification.
          </p>
          <div style="background:#24201B;border:1px solid #6B4D22;border-radius:10px;padding:18px;margin:25px 0;">
            <p style="color:#F59E0B;font-size:13px;font-weight:bold;margin:0 0 10px;">
              INFORMATION REQUESTED BY ADMIN
            </p>
            <p style="color:#FFFFFF;font-size:14px;line-height:1.7;margin:0;overflow-wrap:anywhere;">
              {safe_reason}
            </p>
          </div>
          <p style="color:#A1A1AA;font-size:14px;line-height:1.8;">
            Use the secure link below to update your registration details and resubmit for Admin review.
          </p>
          <p style="margin:22px 0;">
            <a href="{safe_correction_url}" style="display:inline-block;padding:14px 22px;border-radius:8px;background:#F59E0B;color:#070708;text-decoration:none;font-weight:bold;">Review &amp; Resubmit Application</a>
          </p>
          <p style="color:#9E9EA7;font-size:12px;line-height:1.7;">
            This link expires in {expiry_minutes} minutes. If it expires, contact the KSHURAK support team for a new link.
          </p>
          <p style="color:#D4D4D8;font-size:14px;line-height:1.8;">
            Best regards,<br><strong>KSHURAK Team</strong>
          </p>
          <hr style="border:0;border-top:1px solid #27282C;margin:25px 0;">
          <p style="color:#71717A;font-size:12px;">KSHURAK — Style. Confidence. You.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>"""

    await send_email(
        to_email=to_email,
        subject=subject,
        text_body=text_body,
        html_body=html_body,
    )
    logger.info("Barber correction-request email submitted to SMTP server.")
