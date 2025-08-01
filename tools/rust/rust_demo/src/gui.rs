use eframe::egui;
use egui::{Color32, RichText};



use crate::client::Client;
use std::sync::Arc;
use tokio::sync::Mutex;

pub struct T4WebTraderDemo {
    connection_status: bool,
    client: Arc<Mutex<Client>>,
}
impl T4WebTraderDemo {
    pub fn new(client: Arc<Mutex<Client>>) -> Self {
        Self {
            connection_status: false,
            client,
        }
    }
}
impl eframe::App for T4WebTraderDemo {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        // ===== Top Connection Bar =====
        egui::TopBottomPanel::top("connection_panel").show(ctx, |ui| {
            ui.set_height(100.0); // make it taller
            ui.group(|ui| {
                ui.vertical_centered(|ui| {
                    ui.add_space(10.0);
                    ui.heading(RichText::new("T4 WebTrader Connection").size(22.0));

                    ui.horizontal_wrapped(|ui| {
                        let status_color = if self.connection_status { Color32::GREEN } else { Color32::RED };
                        ui.colored_label(status_color, if self.connection_status { "● Connected" } else { "● Disconnected" });

                        ui.label("Account:");
                        egui::ComboBox::from_id_source("account_select")
                            .selected_text("-- Select Account --")
                            .show_ui(ui, |_ui| {});

                        if ui.button("Connect").clicked() {
                            let client_clone = self.client.clone();
                            tokio::spawn(async move {
                                let mut client = client_clone.lock().await;
                                client.connect().await;
                            });
                            self.connection_status = true;
                        }
                        if ui.button("Disconnect").clicked() {
                            let client_clone = self.client.clone();
                            tokio::spawn(async move {
                                let mut client = client_clone.lock().await;
                                // You'll need to store the write handle in the Client struct to pass it here
                                client.disconnect().await;
                            });
                            self.connection_status = false;
                        }
                    });
                });
            });
        });

        // ===== Main 2x2 Layout =====
        egui::CentralPanel::default().show(ctx, |ui| {
            let available_size = ui.available_size();

            // Each row = half the height of the remaining space
            let row_height = available_size.y / 2.0;

            for row in 0..2 {
                ui.horizontal(|ui| {
                    let col_width = available_size.x / 2.0;

                    for col in 0..2 {
                        ui.allocate_ui_with_layout(
                            egui::vec2(col_width - 10.0, row_height - 10.0),
                            egui::Layout::top_down(egui::Align::Min),
                            |ui| {
                                ui.group(|ui| {
                                    match (row, col) {
                                        // ===== Top Left: Market Data =====
                                   
                                    (0, 0) => {
                                    ui.heading(RichText::new("Market Data").color(Color32::BLUE));
                                    ui.separator();

                                    let box_width = ui.available_width() / 3.0;

                                    ui.horizontal(|ui| {
                                        // Best Bid
                                        ui.allocate_ui_with_layout(
                                            egui::vec2(box_width, ui.available_height()),
                                            egui::Layout::top_down(egui::Align::Center),
                                            |ui| {
                                                ui.group(|ui| {
                                                    ui.vertical_centered(|ui| {
                                                        ui.label("Best Bid");
                                                        ui.label("--@--");
                                                    });
                                                });
                                            },
                                        );

                                        // Best Offer
                                        ui.allocate_ui_with_layout(
                                            egui::vec2(box_width, ui.available_height()),
                                            egui::Layout::top_down(egui::Align::Center),
                                            |ui| {
                                                ui.group(|ui| {
                                                    ui.vertical_centered(|ui| {
                                                        ui.label("Best Offer");
                                                        ui.label("--@--");
                                                    });
                                                });
                                            },
                                        );

                                        // Last Trade
                                        ui.allocate_ui_with_layout(
                                            egui::vec2(box_width, ui.available_height()),
                                            egui::Layout::top_down(egui::Align::Center),
                                            |ui| {
                                                ui.group(|ui| {
                                                    ui.vertical_centered(|ui| {
                                                        ui.label("Last Trade");
                                                        ui.label("--@--");
                                                    });
                                                });
                                            },
                                        );
                                    });
                                }

                                        // ===== Top Right: Submit Order =====
                                        (0, 1) => {
                                            ui.heading("Submit Order");
                                            ui.separator();
                                            egui::ComboBox::from_label("Type")
                                                .selected_text("--")
                                                .show_ui(ui, |_ui| {});
                                            egui::ComboBox::from_label("Side")
                                                .selected_text("--")
                                                .show_ui(ui, |_ui| {});
                                            ui.add(egui::TextEdit::singleline(&mut String::new()).hint_text("Volume"));
                                            ui.add(egui::TextEdit::singleline(&mut String::new()).hint_text("Price"));
                                            ui.add(egui::TextEdit::singleline(&mut String::new()).hint_text("Take Profit"));
                                            ui.add(egui::TextEdit::singleline(&mut String::new()).hint_text("Stop Loss"));
                                            ui.button("Submit Order");
                                        }

                                        // ===== Bottom Left: Positions =====
                                        (1, 0) => {
                                            ui.heading("Positions");
                                            ui.separator();
                                            egui::Grid::new("positions").striped(true).show(ui, |ui| {
                                                ui.label("Market");
                                                ui.label("Net");
                                                ui.label("P&L");
                                                ui.label("Working");
                                                ui.end_row();
                                            });
                                        }

                                        // ===== Bottom Right: Orders =====
                                        (1, 1) => {
                                            ui.heading("Orders");
                                            ui.separator();
                                            egui::Grid::new("orders").striped(true).show(ui, |ui| {
                                                ui.label("Time");
                                                ui.label("Market");
                                                ui.label("Side");
                                                ui.label("Volume");
                                                ui.label("Price");
                                                ui.label("Status");
                                                ui.label("Action");
                                                ui.end_row();
                                            });
                                        }

                                        _ => {}
                                    }
                                });
                            }
                        );
                    }
                });
                ui.add_space(10.0); // space between rows
            }
        });
    }
}

