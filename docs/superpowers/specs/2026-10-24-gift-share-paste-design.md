# Gift share paste

Task: IDEA-0001 follow-up. Base: bcd2bed55f3b2dd1c4b9226615547dc20bb24335.

The owner copies a product through the Wildberries app's Share action. The clipboard contains a product title, a newline and its HTTPS URL. The current form validates this entire message as a URL and rejects it. The exact URL alone passes the unchanged shared contract.

Accept this clipboard format in the existing gift URL field. Extract exactly one complete HTTP(S) URL and suggest the surrounding product title only when the title field is blank. Preserve the complete URL, including its size query. Never overwrite a nonblank title. Plain URL paste and normal text editing retain their ordinary behavior. Ambiguous, malformed or credential-bearing URLs stay invalid; the backend/shared validators remain unchanged. No network request is needed for this fix.

Approaches: changing the shared URL contract would store mixed text and weaken a useful boundary; asking the owner to edit the store's copied message defeats the reported workflow. Normalize a recognized share message at the clipboard boundary instead.

Price remains optional. The owner requires gifts to be added exclusively through the application; there is no bot capture flow. Product-photo retrieval is a separately investigated follow-up. Initial plain HTTP requests from the workstation and production host returned marketplace challenge responses. Waiting for normal browser page loading subsequently exposed actual title/image metadata for both provided cards. This proves extraction feasibility, but does not prove that a bounded server renderer is deployed or reliable on the production host. This bugfix patch does not claim to implement network metadata/image retrieval.

Acceptance: the exact Magno World message produces its clean URL and title in the actual form; existing titles survive, no-photo save stays disabled, and selecting a photo enables the existing save journey. A short browser regression must cover the clipboard event, not just the parser.
