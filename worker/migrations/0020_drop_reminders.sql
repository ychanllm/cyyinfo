DROP TABLE IF EXISTS reminders;
DELETE FROM settings WHERE key IN ('smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'default_recipient');
