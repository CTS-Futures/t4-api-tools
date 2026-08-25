#include <QApplication>
#include "mainwindow.h"
#include "ChartTypes.h"

int main(int argc, char* argv[]) {
    QApplication app(argc, argv);

    // Allow Candle / QVector<Candle> to travel through queued signal/slot calls.
    qRegisterMetaType<Candle>("Candle");
    qRegisterMetaType<QVector<Candle>>("QVector<Candle>");

    MainWindow window;
    
    window.show();
    //client->connectToServer();
    return app.exec();
}