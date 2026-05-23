#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    mollie_octopus_sync_lib::run();
}
