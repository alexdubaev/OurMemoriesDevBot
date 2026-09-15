# MAX runtime trust certificates

These public certificates are the Russian Trusted CA chain required by `platform-api2.max.ru`.
They are installed into Debian's standard trust store during the backend image build.

Authoritative source (retrieved with normal TLS):

- <https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt>
- <https://gu-st.ru/content/lending/russian_trusted_sub_ca_pem.crt>

Verified X.509 metadata:

| File | Subject | Issuer | Validity | SHA-256 fingerprint |
| --- | --- | --- | --- | --- |
| `russian_trusted_root_ca_pem.crt` | `CN=Russian Trusted Root CA` | `CN=Russian Trusted Root CA` | 2022-03-01 to 2032-02-27 | `D2:6D:2D:02:31:B7:C3:9F:92:CC:73:85:12:BA:54:10:35:19:E4:40:5D:68:B5:BD:70:3E:97:88:CA:8E:CF:31` |
| `russian_trusted_sub_ca_pem.crt` | `CN=Russian Trusted Sub CA` | `CN=Russian Trusted Root CA` | 2022-03-02 to 2027-03-06 | `BB:BD:E2:10:3E:79:0B:99:9E:C6:2B:D0:3C:F6:25:A5:A2:E7:C3:16:E1:0A:FE:6A:49:0E:ED:EA:D8:B3:FD:9B` |

The build does not download certificates. `update-ca-certificates` adds these files to the normal Debian CA bundle; Bun uses that system trust store for HTTPS verification.
