import express from "express";
import bodyParser from "body-parser";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(bodyParser.json());

// Supabase connection
const SUPABASE_URL = "https://hwbfcqxybnsmxywtriri.supabase.co";
const SUPABASE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh3YmZjcXh5Ym5zbXh5d3RyaXJpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ3NTI1NjgsImV4cCI6MjA3MDMyODU2OH0.KkQ4FVnIWg1Tk0_HxC7QeZXnmDTBGW5pOYxIIq-Vltc";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Function to generate next patient_id
async function generatePatientId() {
  const { data, error } = await supabase
    .from("patient_details")
    .select("patient_id")
    .order("patient_id", { ascending: false })
    .limit(1);

  if (error) throw error;

  let nextNumber = 5000; // start point

  if (data && data.length > 0) {
    const lastId = data[0].patient_id;
    const lastNumber = parseInt(lastId.replace("PAT", ""), 10);
    nextNumber = lastNumber + 1;
  }

  return `PAT${nextNumber}`;
}

// Webhook endpoint
app.post("/", async (req, res) => {
  try {
    const tag = req.body.fulfillmentInfo.tag;
    const params = req.body.sessionInfo.parameters || {};

    console.log("Webhook Tag:", tag);
    console.log("Parameters:", params);

    if (tag === "check_patient") {
      const { patient_id } = params; // use patient_id instead of phone

      const { data, error } = await supabase
        .from("patient_details")
        .select("*")
        .eq("patient_id", patient_id);

      if (error) throw error;

      if (data && data.length > 0) {
        return res.json({
          fulfillment_response: {
            messages: [
              {
                text: {
                  text: [
                    `Hi ${data[0].user_name}, This is your patient_id: ${data[0].patient_id}`,
                  ],
                },
              },
            ],
          },
          sessionInfo: {
            parameters: {
              patient_found: true,
              patient_id: data[0].patient_id,
            },
          },
        });
      } else {
        return res.json({
          fulfillment_response: {
            messages: [{ text: { text: ["Patient not found."] } }],
          },
          sessionInfo: {
            parameters: { patient_found: false },
          },
        });
      }
    }

    if (tag === "check_booking_date") {
      const { patient_id } = params;

      if (!patient_id) {
        return res.json({
          fulfillment_response: {
            messages: [
              {
                text: {
                  text: ["Please provide a valid Patient ID to check booking."],
                },
              },
            ],
          },
          sessionInfo: { parameters: { booking_found: false } },
        });
      }

      // Query patient_details for the patient_id with a non-null booking_date
      const { data, error } = await supabase
        .from("patient_details")
        .select("*")
        .eq("patient_id", patient_id)
        .not("booking_date", "is", null); // ensures booking_date is not null

      if (error) throw error;

      if (data && data.length > 0) {
        const booking = data[0];
        return res.json({
          fulfillment_response: {
            messages: [
              {
                text: {
                  text: [
                    `Hi ${booking.user_name}, you have an appointment booked on ${booking.booking_date} with ${booking.doctor_name} for ${booking.appt_type}.`,
                  ],
                },
              },
            ],
          },
          sessionInfo: {
            parameters: {
              booking_found: true,
              patient_id: booking.patient_id,
              booking_date: booking.booking_date,
              doctor_name: booking.doctor_name,
              appt_type: booking.appt_type,
            },
          },
        });
      } else {
        return res.json({
          fulfillment_response: {
            messages: [
              {
                text: {
                  text: [`No bookings found for Patient ID ${patient_id}.`],
                },
              },
            ],
          },
          sessionInfo: { parameters: { booking_found: false } },
        });
      }
    }

    if (tag === "create_patient") {
      const { user_name, dateofbirth, gender, phone, city } = params;

      // Format dateofbirth if it's an object
      let dobFormatted = null;
      if (dateofbirth && typeof dateofbirth === "object") {
        const { year, month, day } = dateofbirth;
        // Ensure 2-digit month/day
        dobFormatted = `${year}-${String(month).padStart(2, "0")}-${String(
          day
        ).padStart(2, "0")}`;
      } else {
        dobFormatted = dateofbirth; // In case Dialogflow sends it as a string already
      }

      // Generate custom patient ID
      const patient_id = await generatePatientId();

      const { error } = await supabase.from("patient_details").insert([
        {
          patient_id,
          user_name: user_name?.name || user_name, // handle object or string
          dateofbirth: dobFormatted,
          gender,
          phone,
          city,
        },
      ]);

      if (error) throw error;

      return res.json({
        fulfillment_response: {
          messages: [
            {
              text: {
                text: [
                  `Patient registered successfully! Your Patient ID is ${patient_id}`,
                ],
              },
            },
          ],
        },
        sessionInfo: {
          parameters: { patient_id, patient_created: true },
        },
      });
    }

    if (tag === "booking_appointment") {
      const { patient_id, appt_type, doctor_name, booking_date } = params;

      if (!patient_id) {
        return res.json({
          fulfillment_response: {
            messages: [
              { text: { text: ["Please provide a valid Patient ID first."] } },
            ],
          },
        });
      }

      // Format booking_date if it's an object from Dialogflow
      let bookingDateFormatted = null;
      if (booking_date && typeof booking_date === "object") {
        const { year, month, day } = booking_date;
        bookingDateFormatted = `${year}-${String(month).padStart(
          2,
          "0"
        )}-${String(day).padStart(2, "0")}`;
      } else {
        bookingDateFormatted = booking_date; // In case it's already a string
      }

      // Update patient record with appointment details
      const { error } = await supabase
        .from("patient_details")
        .update({
          appt_type,
          doctor_name,
          booking_date: bookingDateFormatted,
        })
        .eq("patient_id", patient_id);

      if (error) throw error;

      return res.json({
        fulfillment_response: {
          messages: [
            {
              text: {
                text: [
                  `Your appointment has been booked successfully!\n\n📅 Date: ${bookingDateFormatted}\n👨‍⚕️ Doctor: ${doctor_name}\n📝 Type: ${appt_type}`,
                ],
              },
            },
          ],
        },
        sessionInfo: {
          parameters: {
            appointment_booked: true,
            appt_type,
            doctor_name,
            booking_date: bookingDateFormatted,
          },
        },
      });
    }

    if (tag === "reschedule_appointment") {
      const { patient_id, reschedule_date } = params;

      if (!patient_id) {
        return res.json({
          fulfillment_response: {
            messages: [
              { text: { text: ["Please provide a valid Patient ID first."] } },
            ],
          },
        });
      }

      // Format reschedule_date if it's an object (Dialogflow date format)
      let rescheduleDateFormatted = null;
      if (reschedule_date && typeof reschedule_date === "object") {
        const { year, month, day } = reschedule_date;
        rescheduleDateFormatted = `${year}-${String(month).padStart(
          2,
          "0"
        )}-${String(day).padStart(2, "0")}`;
      } else {
        rescheduleDateFormatted = reschedule_date; // Already a string
      }

      // Update the patient's record with the reschedule date
      const { error } = await supabase
        .from("patient_details")
        .update({
          reschedule_date: rescheduleDateFormatted,
        })
        .eq("patient_id", patient_id);

      if (error) throw error;

      return res.json({
        fulfillment_response: {
          messages: [
            {
              text: {
                text: [
                  `Your appointment has been rescheduled successfully to ${rescheduleDateFormatted}.`,
                ],
              },
            },
          ],
        },
        sessionInfo: {
          parameters: {
            appointment_rescheduled: true,
            reschedule_date: rescheduleDateFormatted,
          },
        },
      });
    }

    if (tag === "cancel_appointment") {
      const { patient_id } = params;

      if (!patient_id) {
        return res.json({
          fulfillment_response: {
            messages: [
              {
                text: {
                  text: [
                    "Please provide a valid Patient ID to cancel appointment.",
                  ],
                },
              },
            ],
          },
        });
      }

      // Clear appointment details by setting the fields to null
      const { error } = await supabase
        .from("patient_details")
        .update({
          appt_type: null,
          doctor_name: null,
          booking_date: null,
          reschedule_date: null,
        })
        .eq("patient_id", patient_id);

      if (error) throw error;

      return res.json({
        fulfillment_response: {
          messages: [
            {
              text: {
                text: [
                  `Appointment for Patient ID ${patient_id} has been cancelled successfully.`,
                ],
              },
            },
          ],
        },
        sessionInfo: {
          parameters: {
            appointment_cancelled: true,
          },
        },
      });
    }

    // Default fallback
    return res.json({
      fulfillment_response: {
        messages: [{ text: { text: ["Unknown action."] } }],
      },
    });
  } catch (err) {
    console.error("Error in webhook:", err);
    res.status(500).json({
      fulfillment_response: {
        messages: [
          {
            text: {
              text: ["An error occurred while processing your request."],
            },
          },
        ],
      },
    });
  }
});


export const dialogflowWebhook = app;