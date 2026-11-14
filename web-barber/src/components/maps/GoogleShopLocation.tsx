
import { useEffect, useRef, useState } from "react";
import {
  importLibrary,
  setOptions,
} from "@googlemaps/js-api-loader";

export interface SelectedShopLocation {
  address: string;
  city: string;
  state: string;
  pincode: string;
  latitude: string;
  longitude: string;
  placeId: string;
}

interface Props {
  onSelect: (location: SelectedShopLocation) => void;
}

const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

if (apiKey) {
  setOptions({
    key: apiKey,
    v: "weekly",
  });
}

function addressPart(
  parts: google.maps.places.AddressComponent[],
  type: string,
  short = false
): string {
  const item = parts.find((part) =>
    part.types.includes(type)
  );

  if (!item) return "";

  return short
    ? item.shortText || ""
    : item.longText || "";
}

export default function GoogleShopLocation({
  onSelect,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onSelectRef = useRef(onSelect);

  const [status, setStatus] = useState(
    "Search for your shop or business address."
  );

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    if (!apiKey) {
      setStatus(
        "Google Maps API key is missing."
      );
      return;
    }

    let cancelled = false;
    let widget:
      google.maps.places.PlaceAutocompleteElement
      | null = null;

    async function initialize() {
      try {
        const { PlaceAutocompleteElement } =
          await importLibrary("places");

        if (cancelled || !containerRef.current) {
          return;
        }

        widget = new PlaceAutocompleteElement({
          includedRegionCodes: ["in"],
        });

        widget.setAttribute(
          "placeholder",
          "Search your barber shop or street..."
        );

        widget.style.width = "100%";

        widget.addEventListener(
          "gmp-select",
          async (event: Event) => {
            try {
              const selection =
                event as google.maps.places.PlacePredictionSelectEvent;

              const place =
                selection.placePrediction.toPlace();

              await place.fetchFields({
                fields: [
                  "id",
                  "formattedAddress",
                  "location",
                  "addressComponents",
                ],
              });

              if (cancelled || !place.location) {
                return;
              }

              const parts =
                place.addressComponents || [];

              const city =
                addressPart(parts, "locality") ||
                addressPart(
                  parts,
                  "administrative_area_level_3"
                ) ||
                addressPart(
                  parts,
                  "administrative_area_level_2"
                );

              const state = addressPart(
                parts,
                "administrative_area_level_1"
              );

              const pincode = addressPart(
                parts,
                "postal_code"
              );

              const result: SelectedShopLocation = {
                address: place.formattedAddress || "",
                city,
                state,
                pincode,
                latitude: String(
                  place.location.lat()
                ),
                longitude: String(
                  place.location.lng()
                ),
                placeId: place.id || "",
              };

              onSelectRef.current(result);

              setStatus(
                "Location selected from Google Maps. " +
                "Verify the shop address before saving."
              );
            } catch (error) {
              console.error(
                "Google place selection failed:",
                error
              );

              if (!cancelled) {
                setStatus(
                  "Unable to retrieve the selected location."
                );
              }
            }
          }
        );

        containerRef.current.appendChild(widget);

        setStatus(
          "Start typing to see Google Places suggestions."
        );
      } catch (error) {
        console.error(
          "Google Maps initialization failed:",
          error
        );

        if (!cancelled) {
          setStatus(
            "Google Maps could not load. Check the API key, " +
            "billing, and enabled APIs."
          );
        }
      }
    }

    void initialize();

    return () => {
      cancelled = true;
      widget?.remove();
    };
  }, []);

  return (
    <div style={{ marginBottom: 18 }}>
      <label
        style={{
          display: "block",
          color: "#FFFFFF",
          marginBottom: 8,
          fontSize: 12,
          fontWeight: 700,
        }}
      >
        Search Shop Location on Google Maps
      </label>

      <div ref={containerRef} />

      <p
        role="status"
        style={{
          marginTop: 9,
          fontSize: 11,
          color: "#9E9EA7",
        }}
      >
        {status}
      </p>
    </div>
  );
}
